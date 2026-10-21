import { describe, it, expect } from "vitest";
import request from "supertest";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { createApp } from "../src/app.js";
import { JsonKnowledgeStore } from "../src/store/JsonKnowledgeStore.js";
import { AnswerService, MODEL, stripCoverage, type CreateMessage } from "../src/answer/AnswerService.js";
import { SmartRetriever } from "../src/answer/Retriever.js";
import { MemoryConversationStore } from "../src/answer/ConversationStore.js";
import { AnswerMemory, memoryKey } from "../src/answer/AnswerMemory.js";
import { GapService } from "../src/gaps/GapService.js";
import { MemoryGapStore } from "../src/gaps/JsonGapStore.js";
import type { GapVerdict } from "../src/gaps/types.js";
import { MemoryPersist, PersistedRecipients, PersistedReports, PersistedStats } from "../src/reports/collections.js";
import { ReportService } from "../src/reports/ReportService.js";
import { UsageMeter } from "../src/usage/UsageMeter.js";
import type { StoredKnowledgeItem } from "../src/types.js";
import { SYSTEM_PROMPT } from "../src/answer/prompt.js";

function setup(replyText: string) {
  const uploads = new MemoryPersist<StoredKnowledgeItem>();
  const store = new JsonKnowledgeStore(path.join(__dirname, "..", "data", "knowledge.json"), uploads);
  let calls = 0;
  const create: CreateMessage = async () => {
    calls++;
    return { id: "m", type: "message", role: "assistant", model: MODEL, stop_reason: "end_turn",
      content: [{ type: "text", text: replyText, citations: null }], usage: {} as any } as Anthropic.Beta.BetaMessage;
  };
  const memory = new AnswerMemory(new MemoryPersist());
  const answers = new AnswerService(create, new SmartRetriever(store), new MemoryConversationStore(), { store: memory, version: () => store.version() });
  let analyses = 0;
  const verdicts: Partial<GapVerdict>[] = [];
  const stats = new PersistedStats(new MemoryPersist());
  const gaps = new GapService(async (_c, existing) => {
    analyses++;
    return { kind: "no_info", gapTitleHe: "מחיר", gapTitleEn: "Price", matchesGapId: existing[0]?.id ?? null, ...verdicts.shift() };
  }, new MemoryGapStore(), () => `g${Math.random()}`).withStats(stats);
  const usage = new UsageMeter(new MemoryPersist());
  const recipients = new PersistedRecipients(new MemoryPersist(), () => "r");
  const reports = new ReportService({ gaps, stats, recipients, reports: new PersistedReports(new MemoryPersist()), mailer: null, newId: () => "x", usage });
  const app = createApp(store, answers, gaps, { service: reports, recipients, usage });
  return { app, store, uploads, gaps, stats, usage, calls: () => calls, analyses: () => analyses };
}

const settle = () => new Promise((r) => setTimeout(r, 30));

describe("coverage mark", () => {
  it("is in the instructions and removed from what people see", () => {
    expect(SYSTEM_PROMPT).toContain("[[coverage:full]]");
    const r = stripCoverage([{ text: "תשובה.", sourceRefs: [1] }, { text: "\n\n[[coverage:partial]]", sourceRefs: [] }]);
    expect(r.coverage).toBe("partial");
    expect(r.segments).toEqual([{ text: "תשובה.", sourceRefs: [1] }]);
    expect(stripCoverage([{ text: "בלי סימון", sourceRefs: [] }]).coverage).toBeNull();
  });
});

describe("one call per question", () => {
  it("full coverage: no gap analysis, counted as answered", async () => {
    const t = setup("שלבי הטיפול...\n[[coverage:full]]");
    const res = await request(t.app).post("/api/ask").send({ question: "מה עושים בהתראת דליפה?", lang: "he" });
    expect(res.body.segments.map((s: any) => s.text).join("")).not.toContain("coverage");
    await settle();
    expect(t.analyses()).toBe(0);
    expect((await t.stats.since("2000-01-01")).map((s) => s.outcome)).toEqual(["answered"]);
  });

  it("off topic: no analysis, no gap", async () => {
    const t = setup("זה לא קשור לעבודה.\n[[coverage:off_topic]]");
    await request(t.app).post("/api/ask").send({ question: "מה מזג האוויר?", lang: "he" });
    await settle();
    expect(t.analyses()).toBe(0);
    expect((await request(t.app).get("/api/gaps")).body).toHaveLength(0);
  });

  it("partial / none / no mark: gap analysis runs as before", async () => {
    for (const mark of ["[[coverage:none]]", "[[coverage:partial]]", ""]) {
      const t = setup(`אין מידע.\n${mark}`);
      await request(t.app).post("/api/ask").send({ question: "כמה עולה יחידה?", lang: "he" });
      await settle();
      expect(t.analyses()).toBe(1);
    }
  });
});

describe("answer memory", () => {
  it("same question (other punctuation, prefixes, order) is answered from memory without Claude", async () => {
    const t = setup("שלבי הטיפול...\n[[coverage:full]]");
    const first = await request(t.app).post("/api/ask").send({ question: "מה עושים בהתראת דליפה?", lang: "he" });
    expect(first.body.fromMemory).toBeUndefined();
    await settle();
    const again = await request(t.app).post("/api/ask").send({ question: "דליפה התראת עושים מה", lang: "he" });
    expect(again.body.fromMemory).toBeTruthy();
    expect(again.body.segments).toEqual(first.body.segments);
    expect(t.calls()).toBe(1);
    const usage = await request(t.app).get("/api/usage");
    expect(usage.body.month.questions).toBe(1); // the meter records only real calls with usage; memory hit counted below
    expect(usage.body.month.fromMemory).toBe(1);
  });

  it("follow-up after a remembered answer still works", async () => {
    const t = setup("תשובה\n[[coverage:full]]");
    await request(t.app).post("/api/ask").send({ question: "מה עושים בהתראת דליפה?", lang: "he" });
    await settle();
    const again = await request(t.app).post("/api/ask").send({ question: "מה עושים בהתראת דליפה?", lang: "he" });
    const follow = await request(t.app).post("/api/ask").send({ question: "ואם אין מענה?", lang: "he", conversationId: again.body.conversationId });
    expect(follow.status).toBe(200);
    expect(t.calls()).toBe(2);
  });

  it("a remembered gap still counts on its gap, without Claude", async () => {
    const t = setup("אין מידע.\n[[coverage:none]]");
    await request(t.app).post("/api/ask").send({ question: "כמה עולה יחידה?", lang: "he" });
    await settle();
    await request(t.app).post("/api/ask").send({ question: "כמה עולה יחידה", lang: "he" });
    await settle();
    expect(t.analyses()).toBe(1);
    expect(t.calls()).toBe(1);
    const gaps = (await request(t.app).get("/api/gaps")).body;
    expect(gaps).toHaveLength(1);
    expect(gaps[0].count).toBe(2);
  });

  it("adding a document empties the memory", async () => {
    const t = setup("תשובה\n[[coverage:full]]");
    await request(t.app).post("/api/ask").send({ question: "מה האחריות?", lang: "he" });
    await settle();
    await t.store.add({ id: "up-1", type: "document", updatedAt: "2026-11-01", isSample: false, title: "אחריות", topic: "", owner: "", body: "24 חודשים" });
    await request(t.app).post("/api/ask").send({ question: "מה האחריות?", lang: "he" });
    expect(t.calls()).toBe(2);
  });

  it("didn't-help removes the answer from memory", async () => {
    const t = setup("תשובה\n[[coverage:full]]");
    const first = await request(t.app).post("/api/ask").send({ question: "מה האחריות?", lang: "he" });
    await settle();
    await request(t.app).post("/api/feedback").send({ conversationId: first.body.conversationId, turn: 0 });
    await request(t.app).post("/api/ask").send({ question: "מה האחריות?", lang: "he" });
    expect(t.calls()).toBe(2);
  });

  it("only first questions are remembered; languages are separate; empty questions never match", async () => {
    const t = setup("תשובה\n[[coverage:full]]");
    const first = await request(t.app).post("/api/ask").send({ question: "מה האחריות?", lang: "he" });
    await request(t.app).post("/api/ask").send({ question: "ומה עם הסוללה?", lang: "he", conversationId: first.body.conversationId });
    await settle();
    await request(t.app).post("/api/ask").send({ question: "ומה עם הסוללה?", lang: "he" });
    await request(t.app).post("/api/ask").send({ question: "מה האחריות?", lang: "en" });
    expect(t.calls()).toBe(4);
    expect(memoryKey("מה?", "he")).toBe("he:");
  });
});
