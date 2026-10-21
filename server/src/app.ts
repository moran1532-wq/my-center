import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import Anthropic from "@anthropic-ai/sdk";
import type { KnowledgeStore } from "./store/KnowledgeStore.js";
import type { KnowledgeType, Lang } from "./types.js";
import { ConversationNotFoundError, ConversationTooLongError, type AnswerService } from "./answer/AnswerService.js";
import type { GapService } from "./gaps/GapService.js";

const TYPES: KnowledgeType[] = ["procedure", "document", "customer_answer"];
const langOf = (v: unknown): Lang => (v === "en" ? "en" : "he");
const MAX_QUESTION = 2000;

export function createApp(store: KnowledgeStore, answers: AnswerService | null, gaps: GapService | null = null) {
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
        gaps.consider({ question: question.trim(), answerText, lang, notHelpful: false })
          .then((gap) => gap && feedbackGiven.add(key)) // already a gap: "didn't help" must not count it twice
          .catch((e) => console.error("gap check failed:", e instanceof Error ? e.message : e));
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

  app.get("/api/gaps", async (_req, res) => {
    if (!gaps) return res.json([]);
    res.json(await gaps.list());
  });

  for (const [action, status] of [["dismiss", "dismissed"], ["restore", "open"]] as const) {
    app.post(`/api/gaps/:id/${action}`, async (req, res) => {
      if (!gaps) return res.status(503).json({ error: "no_key" });
      const gap = await gaps.setStatus(req.params.id, status);
      if (!gap) return res.status(404).json({ error: "not found" });
      res.json(gap);
    });
  }

  return app;
}
