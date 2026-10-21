import { describe, it, expect } from "vitest";
import request from "supertest";
import path from "node:path";
import os from "node:os";
import { mkdtemp, readFile } from "node:fs/promises";
import type Anthropic from "@anthropic-ai/sdk";
import { GapService } from "../src/gaps/GapService.js";
import { JsonGapStore, MemoryGapStore } from "../src/gaps/JsonGapStore.js";
import type { AnalyzeGap, GapVerdict } from "../src/gaps/types.js";
import { buildAnalyzerPrompt } from "../src/gaps/analyzerPrompt.js";
import { createApp } from "../src/app.js";
import { JsonKnowledgeStore } from "../src/store/JsonKnowledgeStore.js";
import { AnswerService, MODEL, type CreateMessage } from "../src/answer/AnswerService.js";
import { AllDocumentsRetriever } from "../src/answer/Retriever.js";
import { MemoryConversationStore } from "../src/answer/ConversationStore.js";

let n = 0;
const ids = () => `g${++n}`;
const verdict = (v: Partial<GapVerdict>): GapVerdict => ({ kind: "no_info", gapTitleHe: "מחיר יחידה", gapTitleEn: "Unit price", matchesGapId: null, ...v });
const scripted = (vs: Partial<GapVerdict>[]) => {
  const seen: Parameters<AnalyzeGap>[] = [];
  const fn: AnalyzeGap = async (...args) => { seen.push(args); return verdict(vs[Math.min(seen.length - 1, vs.length - 1)]); };
  return { fn, seen };
};
const q = (question: string, notHelpful = false) => ({ question, answerText: "a", lang: "he" as const, notHelpful });

describe("gap rules", () => {
  it("records no-info and partial, skips answered and off-topic", async () => {
    const a = scripted([{ kind: "no_info" }, { kind: "partial", gapTitleHe: "עלות החלפה", gapTitleEn: "Replacement cost" }, { kind: "answered" }, { kind: "off_topic" }]);
    let tick = Date.parse("2026-10-01T00:00:00Z");
    const s = new GapService(a.fn, new MemoryGapStore(), ids, () => new Date((tick += 1000)));
    expect(await s.consider(q("כמה עולה יחידה?"))).not.toBeNull();
    expect((await s.consider(q("זמן סגירה ועלות החלפה?")))?.examples[0].reason).toBe("partial");
    expect(await s.consider(q("מה זמן הסגירה?"))).toBeNull();
    expect(await s.consider(q("מה מזג האוויר?"))).toBeNull();
    expect((await s.list()).map((g) => g.titleHe)).toEqual(["עלות החלפה", "מחיר יחידה"]); // same count: newest first
  });

  it("merges a matching question into the same gap and sorts by count", async () => {
    const a = scripted([{}, { gapTitleHe: "אחר" }, {}]);
    const s = new GapService(a.fn, new MemoryGapStore(), ids);
    const first = (await s.consider(q("כמה עולה יחידה?")))!;
    await s.consider(q("משהו אחר"));
    a.fn; // third call matches the first gap
    const merged = await new GapService(async () => verdict({ matchesGapId: first.id }), (s as any).store, ids).consider(q("How much is a unit?"));
    expect(merged!.id).toBe(first.id);
    expect(merged!.count).toBe(2);
    expect(merged!.examples[0].question).toBe("How much is a unit?");
    expect((await s.list())[0].id).toBe(first.id);
  });

  it("a dismissed gap stays out of the list even when asked again", async () => {
    const store = new MemoryGapStore();
    const s1 = new GapService(async () => verdict({}), store, ids);
    const g = (await s1.consider(q("מה מזג האוויר באתר?")))!;
    await s1.setStatus(g.id, "dismissed");
    const s2 = new GapService(async () => verdict({ matchesGapId: g.id }), store, ids);
    await s2.consider(q("מה מזג האוויר?"));
    expect(await s2.list()).toHaveLength(0);
    expect((await store.get(g.id))!.count).toBe(2);
    await s2.setStatus(g.id, "open");
    expect(await s2.list()).toHaveLength(1);
  });

  it("not-helpful is recorded even if the analyzer thinks it was answered", async () => {
    const s = new GapService(async () => verdict({ kind: "answered", gapTitleHe: "x", gapTitleEn: "x" }), new MemoryGapStore(), ids);
    const g = await s.consider(q("מה עושים?", true));
    expect(g?.examples[0].reason).toBe("not_helpful");
  });

  it("analyses one at a time, so two similar questions never make two gaps", async () => {
    const store = new MemoryGapStore();
    const analyze: AnalyzeGap = async (_c, existing) => {
      await new Promise((r) => setTimeout(r, 20));
      return verdict({ matchesGapId: existing[0]?.id ?? null });
    };
    const s = new GapService(analyze, store, ids);
    await Promise.all([s.consider(q("א")), s.consider(q("ב"))]);
    const all = await s.list();
    expect(all).toHaveLength(1);
    expect(all[0].count).toBe(2);
  });

  it("prompt lists existing gaps and the not-helpful note", () => {
    const p = buildAnalyzerPrompt(q("שאלה", true), [{ id: "g9", titleHe: "מחיר", titleEn: "Price" }]);
    expect(p).toContain("id: g9 | מחיר | Price");
    expect(p).toContain("NOT helpful");
  });
});

describe("gap file", () => {
  it("survives a restart", async () => {
    const file = path.join(await mkdtemp(path.join(os.tmpdir(), "gaps-")), "gaps.json");
    const s = new GapService(async () => verdict({}), new JsonGapStore(file), ids);
    await s.consider(q("כמה עולה יחידה?"));
    const reopened = new GapService(async () => verdict({}), new JsonGapStore(file), ids);
    expect(await reopened.list()).toHaveLength(1);
    expect(JSON.parse(await readFile(file, "utf8"))[0].titleEn).toBe("Unit price");
  });
});

describe("gap API", () => {
  const store = new JsonKnowledgeStore(path.join(__dirname, "..", "data", "knowledge.json"));
  const create: CreateMessage = async () => ({ id: "m", type: "message", role: "assistant", model: MODEL, stop_reason: "end_turn",
    content: [{ type: "text", text: "אין במאגר מידע על זה.", citations: null }], usage: {} as any } as Anthropic.Beta.BetaMessage);

  function setup(analyze: AnalyzeGap) {
    const answers = new AnswerService(create, new AllDocumentsRetriever(store), new MemoryConversationStore());
    const gaps = new GapService(analyze, new MemoryGapStore(), ids);
    return { app: createApp(store, answers, gaps), gaps };
  }

  it("a question without info shows up in /api/gaps", async () => {
    const { app, gaps } = setup(async () => verdict({}));
    await request(app).post("/api/ask").send({ question: "כמה עולה יחידה?", lang: "he" });
    await (gaps as any).queue;
    const res = await request(app).get("/api/gaps");
    expect(res.body).toHaveLength(1);
    expect(res.body[0].examples[0].question).toBe("כמה עולה יחידה?");
  });

  it("feedback uses the server's copy of the question, once per answer", async () => {
    const seen: string[] = [];
    const { app } = setup(async (c) => { seen.push(`${c.notHelpful}:${c.question}`); return verdict({ kind: "answered" }); });
    const asked = await request(app).post("/api/ask").send({ question: "מה עושים בדליפה?", lang: "he" });
    expect(asked.body.turn).toBe(0);
    const body = { conversationId: asked.body.conversationId, turn: 0 };
    expect((await request(app).post("/api/feedback").send(body)).status).toBe(200);
    expect((await request(app).post("/api/feedback").send(body)).status).toBe(200);
    expect(seen.filter((s) => s.startsWith("true:"))).toEqual(["true:מה עושים בדליפה?"]);
    expect((await request(app).get("/api/gaps")).body).toHaveLength(1);
    expect((await request(app).post("/api/feedback").send({ conversationId: "x", turn: 0 })).status).toBe(404);
  });

  it("didn't-help on an answer already logged as a gap does not count twice", async () => {
    const { app, gaps } = setup(async (_c, existing) => verdict({ matchesGapId: existing[0]?.id ?? null }));
    const asked = await request(app).post("/api/ask").send({ question: "כמה עולה?", lang: "he" });
    await (gaps as any).queue;
    await request(app).post("/api/feedback").send({ conversationId: asked.body.conversationId, turn: 0 });
    expect((await request(app).get("/api/gaps")).body[0].count).toBe(1);
  });

  it("didn't-help pressed while the automatic check is still running still counts once", async () => {
    const { app } = setup(async (_c, existing) => {
      await new Promise((r) => setTimeout(r, 50));
      return verdict({ kind: "partial", matchesGapId: existing[0]?.id ?? null });
    });
    const asked = await request(app).post("/api/ask").send({ question: "לחץ מים נמוך?", lang: "he" });
    await request(app).post("/api/feedback").send({ conversationId: asked.body.conversationId, turn: 0 });
    const list = (await request(app).get("/api/gaps")).body;
    expect(list).toHaveLength(1);
    expect(list[0].count).toBe(1);
    expect(list[0].examples.map((e: any) => e.reason)).toEqual(["partial"]);
  });

  it("dismiss and restore", async () => {
    const { app, gaps } = setup(async () => verdict({}));
    const g = (await gaps.consider(q("כמה עולה?")))!;
    expect((await request(app).post(`/api/gaps/${g.id}/dismiss`)).body.status).toBe("dismissed");
    expect((await request(app).get("/api/gaps")).body).toHaveLength(0);
    await request(app).post(`/api/gaps/${g.id}/restore`);
    expect((await request(app).get("/api/gaps")).body).toHaveLength(1);
    expect((await request(app).post("/api/gaps/nope/dismiss")).status).toBe(404);
  });
});
