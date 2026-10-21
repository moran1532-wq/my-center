import { describe, it, expect } from "vitest";
import request from "supertest";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { extractFromFile, extractFromLink, extractFromPaste, htmlToText, hostAllowed, ExtractError } from "../src/intake/extract.js";
import { IntakeService } from "../src/intake/IntakeService.js";
import type { AnalyzeDocument, IntakeAnalysis } from "../src/intake/types.js";
import { buildIntakePrompt } from "../src/intake/intakePrompt.js";
import { JsonKnowledgeStore } from "../src/store/JsonKnowledgeStore.js";
import { MemoryPersist } from "../src/reports/collections.js";
import { GapService } from "../src/gaps/GapService.js";
import { MemoryGapStore } from "../src/gaps/JsonGapStore.js";
import type { GapVerdict } from "../src/gaps/types.js";
import type { StoredKnowledgeItem } from "../src/types.js";
import { createApp } from "../src/app.js";
import { ReportService } from "../src/reports/ReportService.js";
import { PersistedRecipients, PersistedReports, PersistedStats } from "../src/reports/collections.js";
import { buildReportHtml } from "../src/reports/reportHtml.js";

const fixture = (f: string) => readFile(path.join(__dirname, "fixtures", f));
let n = 0;
const ids = () => `x${++n}`;

describe("reading files", () => {
  it("PDF", async () => {
    const r = await extractFromFile(await fixture("price-list.pdf"), "price-list.pdf");
    expect(r.kind).toBe("pdf");
    expect(r.text).toContain("4,200 NIS");
  });
  it("Word", async () => {
    const r = await extractFromFile(await fixture("warranty.docx"), "Warranty.DOCX");
    expect(r.kind).toBe("word");
    expect(r.text).toContain("24 month warranty");
  });
  it("HTML keeps text, drops scripts and styles", () => {
    const { text, title } = htmlToText('<html><head><title>נוהל</title><style>p{}</style></head><body><nav>menu</nav><h1>כותרת</h1><p>שלב 1</p><script>alert(1)</script><a href="x">קישור</a></body></html>');
    expect(title).toBe("נוהל");
    expect(text).toContain("שלב 1");
    expect(text).toContain("קישור");
    expect(text).not.toContain("alert");
    expect(text).not.toContain("menu");
  });
  it("rejects unknown, empty and too-large files; caps long text", async () => {
    await expect(extractFromFile(Buffer.from("x"), "a.exe")).rejects.toMatchObject({ code: "unsupported" });
    await expect(extractFromFile(Buffer.from("   "), "a.txt")).rejects.toMatchObject({ code: "empty" });
    await expect(extractFromFile(Buffer.alloc(11 * 1024 * 1024), "a.txt")).rejects.toMatchObject({ code: "too_large" });
    await expect(extractFromFile(Buffer.from("not a pdf"), "a.pdf")).rejects.toMatchObject({ code: "unreadable" });
    const long = extractFromPaste("א".repeat(70_000));
    expect(long.truncated).toBe(true);
    expect(long.text.length).toBe(60_000);
  });
});

describe("reading links", () => {
  const page = (body: string, headers: Record<string, string> = { "content-type": "text/html" }, status = 200) =>
    new Response(body, { status, headers });

  it("host must be on the approved list (subdomains count)", () => {
    expect(hostAllowed("wiki.wint.ai", ["wint.ai"])).toBe(true);
    expect(hostAllowed("wint.ai.evil.com", ["wint.ai"])).toBe(false);
    expect(hostAllowed("localhost", ["wint.ai"])).toBe(false);
  });

  it("reads an approved page", async () => {
    const r = await extractFromLink("https://wiki.wint.ai/proc", ["wint.ai"], async () => page("<title>נוהל</title><p>שלב 1</p>"));
    expect(r.text).toContain("שלב 1");
    expect(r.finalUrl).toBe("https://wiki.wint.ai/proc");
  });

  it("blocks unapproved hosts, other protocols, and redirects to unapproved hosts", async () => {
    const never = async () => { throw new Error("should not fetch"); };
    await expect(extractFromLink("http://169.254.169.254/meta", ["wint.ai"], never as any)).rejects.toMatchObject({ code: "host_not_allowed" });
    await expect(extractFromLink("file:///etc/passwd", ["wint.ai"], never as any)).rejects.toMatchObject({ code: "bad_link" });
    await expect(extractFromLink("https://user:pw@wint.ai/", ["wint.ai"], never as any)).rejects.toMatchObject({ code: "bad_link" });
    const redirect = async () => page("", { location: "http://10.0.0.5/admin" }, 302);
    await expect(extractFromLink("https://wint.ai/go", ["wint.ai"], redirect as any)).rejects.toMatchObject({ code: "host_not_allowed" });
  });

  it("stops reading pages over 5 MB", async () => {
    const big = async () => page("a".repeat(6 * 1024 * 1024), { "content-type": "text/plain" });
    await expect(extractFromLink("https://wint.ai/big", ["wint.ai"], big as any)).rejects.toMatchObject({ code: "too_large" });
  });

  it("is an ExtractError", async () => {
    await expect(extractFromLink("not a url", [])).rejects.toBeInstanceOf(ExtractError);
  });
});

function setup(analysis: Partial<IntakeAnalysis> = {}) {
  const uploads = new MemoryPersist<StoredKnowledgeItem>();
  const knowledge = new JsonKnowledgeStore(path.join(__dirname, "..", "data", "knowledge.json"), uploads);
  const verdicts: Partial<GapVerdict>[] = [];
  const gaps = new GapService(async (_c, existing) => ({ kind: "no_info", gapTitleHe: "אחריות", gapTitleEn: "Warranty", matchesGapId: existing[0]?.id ?? null, ...verdicts.shift() }),
    new MemoryGapStore(), ids);
  const seen: Parameters<AnalyzeDocument>[] = [];
  const intake = new IntakeService({
    analyze: async (...args) => {
      seen.push(args);
      return { titleHe: "מדיניות אחריות", titleEn: "Warranty policy", type: "document", topicHe: "אחריות", topicEn: "Warranty",
        sourceLang: "en", targetGap: args[1] ? { answers: true, explanationHe: "כן", explanationEn: "yes" } : null, alsoAnswersGapIds: [], ...analysis };
    },
    translate: async (text, to) => `[${to}] ${text}`,
    knowledge, gaps, newId: ids,
  });
  return { knowledge, gaps, intake, uploads, seen, verdicts };
}

describe("upload flow", () => {
  it("document for a gap: suggested, saved in both languages, gap closed, Claude can now read it", async () => {
    const t = setup();
    const gap = (await t.gaps.consider({ question: "מה האחריות?", answerText: "", lang: "he", notHelpful: false }))!;
    const draft = await t.intake.preview({ extracted: extractFromPaste("24 month warranty."), gapId: gap.id });
    expect(t.seen[0][1]?.questions).toEqual(["מה האחריות?"]);
    expect(draft.suggestedGaps).toEqual([{ id: gap.id, titleHe: "אחריות", titleEn: "Warranty", isTarget: true }]);
    expect(await t.knowledge.list()).toHaveLength(12); // nothing saved yet

    const out = await t.intake.commit({ draftId: draft.id, titleHe: "מדיניות אחריות", titleEn: "Warranty policy", type: "document",
      topicHe: "אחריות", topicEn: "Warranty", closeGapIds: [gap.id] });
    expect(out.closed.map((c) => c.id)).toEqual([gap.id]);
    const he = await t.knowledge.get(out.itemId, "he");
    const en = await t.knowledge.get(out.itemId, "en");
    expect(he!.body).toBe("[he] 24 month warranty.");
    expect(en!.body).toBe("24 month warranty.");
    expect(he!.isSample).toBe(false);
    expect(await t.knowledge.list()).toHaveLength(13);
    expect(await t.gaps.list()).toHaveLength(0);
    expect((await t.gaps.listClosed())[0].closedByItemId).toBe(out.itemId);
  });

  it("when the document doesn't answer, nothing is suggested and the gap stays open unless the owner closes it", async () => {
    const t = setup({ targetGap: { answers: false, explanationHe: "אין בו משך אחריות", explanationEn: "no duration" } });
    const gap = (await t.gaps.consider({ question: "מה האחריות?", answerText: "", lang: "he", notHelpful: false }))!;
    const draft = await t.intake.preview({ extracted: extractFromPaste("מחירון"), gapId: gap.id });
    expect(draft.suggestedGaps).toEqual([]);
    expect(draft.analysis.targetGap?.explanationHe).toBe("אין בו משך אחריות");
    await t.intake.commit({ draftId: draft.id, titleHe: "מחירון", titleEn: "Prices", type: "document", topicHe: "", topicEn: "", closeGapIds: [] });
    expect(await t.gaps.list()).toHaveLength(1);
  });

  it("a document added without a gap can close other open gaps", async () => {
    const t = setup();
    const gap = (await t.gaps.consider({ question: "כמה עולה?", answerText: "", lang: "he", notHelpful: false }))!;
    const t2 = setup({ alsoAnswersGapIds: [gap.id, "unknown-id"] });
    (t2 as any).intake["gaps"] = t.gaps;
    const draft = await t2.intake.preview({ extracted: extractFromPaste("price list") });
    expect(draft.suggestedGaps).toEqual([{ id: gap.id, titleHe: "אחריות", titleEn: "Warranty", isTarget: false }]);
  });

  it("a closed gap that is asked again reopens", async () => {
    const t = setup();
    const gap = (await t.gaps.consider({ question: "מה האחריות?", answerText: "", lang: "he", notHelpful: false }))!;
    await t.gaps.close(gap.id, "doc");
    await t.gaps.consider({ question: "כמה זמן אחריות?", answerText: "", lang: "he", notHelpful: false });
    const open = await t.gaps.list();
    expect(open.map((g) => g.id)).toEqual([gap.id]);
    expect(open[0].closedAt).toBeUndefined();
  });

  it("prompt includes the gap's questions and other open gaps", () => {
    const p = buildIntakePrompt("doc", { id: "g1", titleHe: "אחריות", titleEn: "Warranty", questions: ["מה האחריות?"] },
      [{ id: "g1", titleHe: "אחריות", titleEn: "Warranty", questions: [] }, { id: "g2", titleHe: "מחיר", titleEn: "Price", questions: ["כמה עולה?"] }]);
    expect(p).toContain('asked as: "מה האחריות?"');
    expect(p).toContain("id: g2 | מחיר | Price");
    expect(p.match(/id: g1/g)).toHaveLength(1);
  });
});

describe("report shows closed gaps", () => {
  it("lists gaps closed since the last report", async () => {
    const t = setup();
    const gap = (await t.gaps.consider({ question: "מה האחריות?", answerText: "", lang: "he", notHelpful: false }))!;
    const service = new ReportService({ gaps: t.gaps, stats: new PersistedStats(new MemoryPersist()), recipients: new PersistedRecipients(new MemoryPersist(), ids),
      reports: new PersistedReports(new MemoryPersist()), mailer: null, newId: ids });
    await t.gaps.close(gap.id, "doc");
    const r = await service.generate("manual");
    expect(r.closed?.map((c) => c.titleEn)).toEqual(["Warranty"]);
    expect(buildReportHtml(r, "he")).toContain("פער אחד נסגר מאז הדוח הקודם");
  });
});

describe("upload API", () => {
  function appFor(t: ReturnType<typeof setup>, fetchImpl?: typeof fetch) {
    return createApp(t.knowledge, null, t.gaps, null, { intake: t.intake, allowedHosts: ["wint.ai"], fetchImpl });
  }

  it("file with a Hebrew name → preview → commit → visible in browse and closed list", async () => {
    const t = setup();
    const gap = (await t.gaps.consider({ question: "מה האחריות?", answerText: "", lang: "he", notHelpful: false }))!;
    const app = appFor(t);
    const prev = await request(app).post("/api/uploads/preview")
      .field("gapId", gap.id)
      .attach("file", await fixture("warranty.docx"), { filename: "מדיניות אחריות.docx" });
    expect(prev.status).toBe(200);
    expect(prev.body.kind).toBe("word");
    expect(prev.body.excerpt).toContain("24 month");
    expect(prev.body.suggestedGaps[0].isTarget).toBe(true);

    const done = await request(app).post("/api/uploads/commit").send({
      draftId: prev.body.draftId, titleHe: "מדיניות אחריות", titleEn: "Warranty policy", type: "document",
      topicHe: "אחריות", topicEn: "Warranty", closeGapIds: [gap.id] });
    expect(done.status).toBe(200);
    expect((await request(app).get(`/api/knowledge/${done.body.itemId}?lang=en`)).body.title).toBe("Warranty policy");
    expect((await request(app).get("/api/gaps?status=closed")).body).toHaveLength(1);
    expect((await request(app).post("/api/uploads/commit").send({ draftId: prev.body.draftId, titleHe: "x", type: "document" })).status).toBe(404);
  });

  it("paste, link and errors", async () => {
    const t = setup();
    const app = appFor(t, (async () => new Response("<p>נוהל חדש</p>", { headers: { "content-type": "text/html" } })) as any);
    expect((await request(app).post("/api/uploads/preview").field("text", "טקסט מודבק")).body.kind).toBe("paste");
    const link = await request(app).post("/api/uploads/preview").field("url", "https://wiki.wint.ai/p");
    expect(link.body.sourceUrl).toBe("https://wiki.wint.ai/p");
    expect((await request(app).post("/api/uploads/preview").field("url", "http://localhost:3001/api/gaps")).body.error).toBe("host_not_allowed");
    expect((await request(app).post("/api/uploads/preview").attach("file", Buffer.from("x"), "virus.exe")).body.error).toBe("unsupported");
    expect((await request(app).post("/api/uploads/preview")).body.error).toBe("empty");
    expect((await request(app).post("/api/uploads/commit").send({ draftId: "d", type: "bad" })).status).toBe(400);
  });
});
