import { describe, it, expect } from "vitest";
import path from "node:path";
import { JsonKnowledgeStore } from "../src/store/JsonKnowledgeStore.js";
import { SmartRetriever } from "../src/answer/Retriever.js";
import { terms } from "../src/answer/search.js";
import { UsageMeter } from "../src/usage/UsageMeter.js";
import { costUsd } from "../src/usage/pricing.js";
import { MemoryPersist } from "../src/reports/collections.js";

const large = new JsonKnowledgeStore(path.join(__dirname, "..", "data", "knowledge-large.json"));
const small = new JsonKnowledgeStore(path.join(__dirname, "..", "data", "knowledge.json"));
const retriever = new SmartRetriever(large);

describe("Hebrew words", () => {
  it("finds a word with or without one-letter prefixes", () => {
    expect(terms("בסוללה")).toContain("סוללה");
    expect(terms("והתראה")).toContain("התראה");
    expect(terms("ההתראות")).toContain("התראות");
    expect(terms("מה")).toEqual([]);
  });
});

describe("smart search", () => {
  const cases: [string, "he" | "en", string][] = [
    ["איך מחליפים סוללה ביחידה?", "he", "proc-battery-replace"],
    ["מה עושים בהתראת דליפה?", "he", "proc-leak-alert"],
    ["מה זמן התגובה שהתחייבנו ללקוח לתקלה דחופה?", "he", "doc-sla"],
    ["איך מצמדים חיישן רצפה חדש?", "he", "proc-sensor-pairing"],
    ["What happens when the power goes out?", "en", "ans-power-outage"],
    ["How do I cancel the subscription?", "en", "ans-cancel"],
    // a Hebrew question finds a document through its English version too
    ["מה הטווח של החיישן האלחוטי?", "he", "doc-sensor-spec"],
    ["Customer says the water stopped, why?", "en", "ans-why-shutoff"],
  ];
  for (const [q, lang, id] of cases) {
    it(`"${q}" → ${id} in the top 6`, async () => {
      const docs = await retriever.documentsFor(q, lang);
      expect(docs).toHaveLength(6);
      expect(docs.map((d) => d.id)).toContain(id);
    });
  }

  it("still sends 6 documents when nothing matches - Claude decides", async () => {
    expect(await retriever.documentsFor("מה מזג האוויר מחר?", "he")).toHaveLength(6);
  });

  it("below 20 documents, everything is sent", async () => {
    expect(await new SmartRetriever(small).documentsFor("סוללה", "he")).toHaveLength(12);
  });
});

describe("cost meter", () => {
  it("prices tokens per model", () => {
    expect(costUsd("claude-opus-5-5", { input_tokens: 1_000_000 })).toBe(4);
    expect(costUsd("claude-opus-5-5", { output_tokens: 1_000_000, cache_read_input_tokens: 1_000_000 })).toBeCloseTo(20.2);
    expect(costUsd("unknown-model", { input_tokens: 1_000_000 })).toBe(4);
  });

  it("sums the month and the cost per question", async () => {
    let t = Date.parse("2026-11-03T08:00:00Z");
    const meter = new UsageMeter(new MemoryPersist(), () => new Date((t += 1000)));
    await meter.record("answer", "claude-opus-5-5", { input_tokens: 7000, output_tokens: 1000 });
    await meter.record("gap_check", "claude-opus-5-5", { input_tokens: 1500, output_tokens: 300 });
    await meter.record("translation", "claude-opus-5-5", { output_tokens: 5000 });
    await meter.record("answer", "claude-opus-5-5", null);
    const s = await meter.summary("2026-11-01T00:00:00Z");
    expect(s.questions).toBe(1);
    expect(s.usd).toBeCloseTo(0.028 + 0.02 + 0.006 + 0.006 + 0.1);
    expect(s.perQuestionUsd).toBeCloseTo(0.06);
  });
});

import request from "supertest";
import { createApp } from "../src/app.js";
import { GapService } from "../src/gaps/GapService.js";
import { MemoryGapStore } from "../src/gaps/JsonGapStore.js";
import { ReportService } from "../src/reports/ReportService.js";
import { PersistedRecipients, PersistedReports, PersistedStats } from "../src/reports/collections.js";
import { buildReportHtml } from "../src/reports/reportHtml.js";

describe("costs in reports and API", () => {
  it("report shows the period cost; owners get the month summary", async () => {
    const usage = new UsageMeter(new MemoryPersist());
    await usage.record("answer", "claude-opus-5-5", { input_tokens: 7000, output_tokens: 1000 });
    const gaps = new GapService(async () => { throw new Error(); }, new MemoryGapStore(), () => "g");
    const recipients = new PersistedRecipients(new MemoryPersist(), () => "r");
    const service = new ReportService({ gaps, stats: new PersistedStats(new MemoryPersist()), recipients,
      reports: new PersistedReports(new MemoryPersist()), mailer: null, newId: () => "rep", usage });
    const r = await service.generate("manual");
    expect(r.cost?.usd).toBeCloseTo(0.048);
    expect(buildReportHtml(r, "he")).toContain("עלות Claude בתקופה: $0.048");
    const app = createApp(small, null, gaps, { service, recipients, usage });
    const res = await request(app).get("/api/usage");
    expect(res.body.measured).toBe(true);
    expect(res.body.month.questions).toBe(1);
  });
});
