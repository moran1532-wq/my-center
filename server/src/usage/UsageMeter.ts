import type { Persist } from "../reports/collections.js";
import { costUsd, type TokenUsage } from "./pricing.js";

/** "memory" = a question answered from memory: counted as a question, costs nothing */
export type UsageKind = "answer" | "gap_check" | "doc_analysis" | "translation" | "memory";

export interface UsageRecord {
  at: string;
  kind: UsageKind;
  model: string;
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  usd: number;
}

export interface UsageSummary {
  questions: number;
  /** of the questions, how many were answered from memory */
  fromMemory: number;
  calls: number;
  usd: number;
  perQuestionUsd: number;
  byKind: Record<UsageKind, number>;
}

const KEEP_MS = 400 * 86400000;

/** Records what each Claude call cost (tokens only - never the text). */
export class UsageMeter {
  private readonly p: Persist<UsageRecord>;
  private readonly now: () => Date;
  constructor(p: Persist<UsageRecord>, now: () => Date = () => new Date()) {
    this.p = p;
    this.now = now;
  }

  async record(kind: UsageKind, model: string, u: TokenUsage | null | undefined) {
    if (!u) return;
    if (kind === "memory") u = {};
    const rec: UsageRecord = {
      at: this.now().toISOString(), kind, model,
      input: u.input_tokens ?? 0, output: u.output_tokens ?? 0,
      cacheWrite: u.cache_creation_input_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0,
      usd: costUsd(model, u),
    };
    const cutoff = this.now().getTime() - KEEP_MS;
    const all = (await this.p.read()).filter((r) => Date.parse(r.at) > cutoff);
    all.push(rec);
    await this.p.write(all);
  }

  async summary(sinceIso: string): Promise<UsageSummary> {
    const recs = (await this.p.read()).filter((r) => r.at > sinceIso);
    const byKind: Record<UsageKind, number> = { answer: 0, gap_check: 0, doc_analysis: 0, translation: 0, memory: 0 };
    for (const r of recs) byKind[r.kind] += r.usd;
    const usd = recs.reduce((s, r) => s + r.usd, 0);
    const questions = recs.filter((r) => r.kind === "answer" || r.kind === "memory").length;
    return { questions, fromMemory: recs.filter((r) => r.kind === "memory").length, calls: recs.length, usd, perQuestionUsd: questions ? (byKind.answer + byKind.gap_check) / questions : 0, byKind };
  }
}

/** Start of the current month in Israel time, as ISO. */
export function monthStartIso(now = new Date()) {
  const [y, m] = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit" })
    .format(now).split("-").map(Number);
  // midnight Israel ≈ 21:00/22:00 UTC the day before; a few hours early is fine for a monthly total
  return new Date(Date.UTC(y, m - 1, 1) - 3 * 3600_000).toISOString();
}
