import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import Anthropic from "@anthropic-ai/sdk";
import type { KnowledgeStore } from "./store/KnowledgeStore.js";
import type { KnowledgeType, Lang } from "./types.js";
import { ConversationNotFoundError, ConversationTooLongError, type AnswerService } from "./answer/AnswerService.js";
import type { GapService } from "./gaps/GapService.js";
import type { ReportService } from "./reports/ReportService.js";
import type { RecipientStore, ReportData } from "./reports/types.js";
import { buildReportHtml, reportSubject } from "./reports/reportHtml.js";
import multer from "multer";
import { ExtractError, MAX_FILE_BYTES, extractFromFile, extractFromLink, extractFromPaste } from "./intake/extract.js";
import { DraftNotFoundError, type IntakeService } from "./intake/IntakeService.js";

const TYPES: KnowledgeType[] = ["procedure", "document", "customer_answer"];
const langOf = (v: unknown): Lang => (v === "en" ? "en" : "he");
const MAX_QUESTION = 2000;

export interface Reporting {
  service: ReportService;
  recipients: RecipientStore;
}

export interface Uploads {
  intake: IntakeService;
  /** hosts links may be read from (LINK_ALLOWED_HOSTS) */
  allowedHosts: string[];
  fetchImpl?: typeof fetch;
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

export function createApp(
  store: KnowledgeStore,
  answers: AnswerService | null,
  gaps: GapService | null = null,
  reporting: Reporting | null = null,
  uploads: Uploads | null = null,
) {
  const app = express();
  // Only origins listed in ALLOWED_ORIGINS may call the API from a browser.
  // In development the client goes through the Vite proxy, so none are needed.
  const origins = (process.env.ALLOWED_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean);
  app.use(cors({ origin: origins.length ? origins : false }));
  app.use("/api", rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));
  app.use(express.json({ limit: "32kb" }));

  app.get("/api/knowledge", async (req, res) => {
    const type = typeof req.query.type === "string" ? req.query.type : undefined;
    if (type && !TYPES.includes(type as KnowledgeType)) {
      return res.status(400).json({ error: "invalid type" });
    }
    const q = typeof req.query.q === "string" ? req.query.q.slice(0, 200) : undefined;
    const items = await store.list({ type: type as KnowledgeType | undefined, q, lang: langOf(req.query.lang) });
    // list view does not need the full body
    res.json(items.map(({ body, ...rest }) => ({ ...rest, excerpt: body.slice(0, 160) })));
  });

  app.get("/api/knowledge/:id", async (req, res) => {
    const item = await store.get(req.params.id, langOf(req.query.lang));
    if (!item) return res.status(404).json({ error: "not found" });
    res.json(item);
  });

  /** answers already counted as a gap (by the automatic check or by feedback) */
  const feedbackGiven = new Set<string>();
  /** automatic gap checks still running, so feedback can wait for them */
  const pendingChecks = new Map<string, Promise<void>>();

  // Each question costs money, so it gets its own, tighter limit.
  const askLimit = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false });

  app.post("/api/ask", askLimit, async (req, res) => {
    if (!answers) return res.status(503).json({ error: "no_key" });
    const { question, conversationId } = req.body ?? {};
    if (typeof question !== "string" || !question.trim() || question.length > MAX_QUESTION) {
      return res.status(400).json({ error: "invalid question" });
    }
    if (conversationId !== undefined && (typeof conversationId !== "string" || conversationId.length > 100)) {
      return res.status(400).json({ error: "invalid conversation" });
    }
    try {
      const lang = langOf(req.body.lang);
      const result = await answers.ask({ question: question.trim(), lang, conversationId });
      res.json(result);
      // Gap check runs after the answer is sent, so it never slows the answer down.
      if (gaps && result.status === "answered") {
        const answerText = result.segments.map((s) => s.text).join("");
        const key = `${result.conversationId}:${result.turn}`;
        const check = gaps.consider({ question: question.trim(), answerText, lang, notHelpful: false })
          .then((gap) => { if (gap) feedbackGiven.add(key); }) // already a gap: "didn't help" must not count it twice
          .catch((e) => console.error("gap check failed:", e instanceof Error ? e.message : e))
          .finally(() => pendingChecks.delete(key));
        pendingChecks.set(key, check);
      }
    } catch (err) {
      if (err instanceof ConversationNotFoundError) return res.status(404).json({ error: "conversation_expired" });
      if (err instanceof ConversationTooLongError) return res.status(409).json({ error: "conversation_too_long" });
      if (err instanceof Anthropic.AuthenticationError) {
        console.error("Claude rejected the API key");
        return res.status(503).json({ error: "bad_key" });
      }
      if (err instanceof Anthropic.RateLimitError) return res.status(429).json({ error: "busy" });
      console.error("ask failed:", err instanceof Error ? err.message : err);
      res.status(502).json({ error: "ai_unavailable" });
    }
  });

  app.post("/api/feedback", askLimit, async (req, res) => {
    if (!answers || !gaps) return res.status(503).json({ error: "no_key" });
    const { conversationId, turn } = req.body ?? {};
    if (typeof conversationId !== "string" || conversationId.length > 100 || !Number.isInteger(turn) || turn < 0) {
      return res.status(400).json({ error: "invalid feedback" });
    }
    const key = `${conversationId}:${turn}`;
    await pendingChecks.get(key);
    if (feedbackGiven.has(key)) return res.json({ ok: true });
    const t = await answers.turn(conversationId, turn);
    if (!t) return res.status(404).json({ error: "conversation_expired" });
    feedbackGiven.add(key);
    try {
      await gaps.consider({ ...t, notHelpful: true });
      res.json({ ok: true });
    } catch (e) {
      feedbackGiven.delete(key);
      console.error("feedback gap failed:", e instanceof Error ? e.message : e);
      res.status(502).json({ error: "ai_unavailable" });
    }
  });

  app.get("/api/gaps", async (req, res) => {
    if (!gaps) return res.json([]);
    res.json(req.query.status === "closed" ? await gaps.listClosed() : await gaps.list());
  });

  for (const [action, status] of [["dismiss", "dismissed"], ["restore", "open"]] as const) {
    app.post(`/api/gaps/:id/${action}`, async (req, res) => {
      if (!gaps) return res.status(503).json({ error: "no_key" });
      const gap = await gaps.setStatus(req.params.id, status);
      if (!gap) return res.status(404).json({ error: "not found" });
      res.json(gap);
    });
  }

  // ---- uploading knowledge ----
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 5 } });
  const uploadLimit = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false });
  const KNOWLEDGE_TYPES: KnowledgeType[] = ["procedure", "document", "customer_answer"];

  app.post("/api/uploads/preview", uploadLimit, (req, res, next) => {
    upload.single("file")(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "too_large" : "bad_upload" });
      next();
    });
  }, async (req, res) => {
    if (!uploads) return res.status(503).json({ error: "no_key" });
    const { url, text, gapId } = req.body ?? {};
    try {
      let extracted;
      let sourceUrl: string | undefined;
      if (req.file) {
        // multer reads names as latin1; Hebrew file names need utf8
        const name = Buffer.from(req.file.originalname, "latin1").toString("utf8");
        extracted = await extractFromFile(req.file.buffer, name);
      } else if (typeof url === "string" && url.trim()) {
        const r = await extractFromLink(url.trim(), uploads.allowedHosts, uploads.fetchImpl);
        extracted = r;
        sourceUrl = r.finalUrl;
      } else if (typeof text === "string" && text.trim()) {
        extracted = extractFromPaste(text.slice(0, 200_000));
      } else return res.status(400).json({ error: "empty" });

      const draft = await uploads.intake.preview({
        extracted, sourceUrl, gapId: typeof gapId === "string" && gapId ? gapId : null,
      });
      res.json({
        draftId: draft.id,
        kind: draft.extracted.kind,
        truncated: draft.extracted.truncated,
        excerpt: draft.extracted.text.slice(0, 1500),
        chars: draft.extracted.text.length,
        sourceUrl: draft.sourceUrl ?? null,
        analysis: draft.analysis,
        suggestedGaps: draft.suggestedGaps,
      });
    } catch (e) {
      if (e instanceof ExtractError) return res.status(400).json({ error: e.code });
      console.error("upload preview failed:", e instanceof Error ? e.message : e);
      res.status(502).json({ error: "ai_unavailable" });
    }
  });

  app.post("/api/uploads/commit", uploadLimit, async (req, res) => {
    if (!uploads) return res.status(503).json({ error: "no_key" });
    const b = req.body ?? {};
    const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
    if (typeof b.draftId !== "string" || !KNOWLEDGE_TYPES.includes(b.type)) return res.status(400).json({ error: "invalid" });
    const titleHe = str(b.titleHe, 200);
    const titleEn = str(b.titleEn, 200);
    if (!titleHe && !titleEn) return res.status(400).json({ error: "missing_title" });
    const closeGapIds = Array.isArray(b.closeGapIds) ? b.closeGapIds.filter((x: unknown) => typeof x === "string").slice(0, 20) : [];
    try {
      res.json(await uploads.intake.commit({
        draftId: b.draftId, type: b.type, titleHe, titleEn,
        topicHe: str(b.topicHe, 60), topicEn: str(b.topicEn, 60), closeGapIds,
      }));
    } catch (e) {
      if (e instanceof DraftNotFoundError) return res.status(404).json({ error: "draft_expired" });
      console.error("upload commit failed:", e instanceof Error ? e.message : e);
      res.status(502).json({ error: "ai_unavailable" });
    }
  });

  // ---- reports ----
  const summary = (r: ReportData) => ({
    id: r.id, createdAt: r.createdAt, periodStart: r.periodStart, trigger: r.trigger, stats: r.stats,
    gapCount: r.gaps.length, newCount: r.gaps.filter((g) => g.isNew).length, delivery: r.delivery,
    subjects: { he: reportSubject(r, "he"), en: reportSubject(r, "en") },
  });
  const reportLimit = rateLimit({ windowMs: 60_000, limit: 5, standardHeaders: true, legacyHeaders: false });

  app.get("/api/reports", async (_req, res) => {
    if (!reporting) return res.json({ reports: [], nextDue: null });
    const reports = await reporting.service.list();
    res.json({ reports: reports.map(summary), nextDue: (await reporting.service.nextDue()).toISOString() });
  });

  app.post("/api/reports", reportLimit, async (_req, res) => {
    if (!reporting) return res.status(503).json({ error: "reports_off" });
    res.json(summary(await reporting.service.generate("manual")));
  });

  app.get("/api/reports/:id/html", async (req, res) => {
    const r = reporting && (await reporting.service.get(req.params.id));
    if (!r) return res.status(404).json({ error: "not found" });
    res.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src data:");
    res.type("html").send(buildReportHtml(r, langOf(req.query.lang)));
  });

  // ---- knowledge owners who get the report ----
  app.get("/api/recipients", async (_req, res) => {
    res.json(reporting ? await reporting.recipients.list() : []);
  });

  app.post("/api/recipients", async (req, res) => {
    if (!reporting) return res.status(503).json({ error: "reports_off" });
    const { name, email, lang } = req.body ?? {};
    if (typeof name !== "string" || !name.trim() || name.length > 100) return res.status(400).json({ error: "invalid name" });
    if (typeof email !== "string" || !EMAIL.test(email.trim())) return res.status(400).json({ error: "invalid email" });
    if ((await reporting.recipients.list()).length >= 50) return res.status(400).json({ error: "too many" });
    res.json(await reporting.recipients.add({ name: name.trim(), email: email.trim(), lang: langOf(lang) }));
  });

  app.delete("/api/recipients/:id", async (req, res) => {
    if (!reporting) return res.status(503).json({ error: "reports_off" });
    if (!(await reporting.recipients.remove(req.params.id))) return res.status(404).json({ error: "not found" });
    res.json({ ok: true });
  });

  return app;
}
