import type { AnalyzeGap, Gap, GapCandidate, GapReason, GapStore } from "./types.js";
import type { StatsStore } from "../reports/types.js";

export const MAX_EXAMPLES = 5;

/** Decides whether a question is a knowledge gap and records it. No Node or network code - also used by the preview. */
export class GapService {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly analyze: AnalyzeGap;
  private readonly store: GapStore;
  private readonly newId: () => string;
  private readonly now: () => Date;
  private stats: StatsStore | null = null;

  constructor(analyze: AnalyzeGap, store: GapStore, newId: () => string, now: () => Date = () => new Date()) {
    this.analyze = analyze;
    this.store = store;
    this.newId = newId;
    this.now = now;
  }

  /** Count every analysed question's outcome (no text kept) for the report's numbers. */
  withStats(stats: StatsStore) {
    this.stats = stats;
    return this;
  }

  /** Analyses one question. Runs one at a time so two similar questions never create two gaps. */
  consider(candidate: GapCandidate): Promise<Gap | null> {
    const run = this.queue.then(() => this.considerNow(candidate));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async considerNow(c: GapCandidate): Promise<Gap | null> {
    const all = await this.store.list();
    const verdict = await this.analyze(c, all.map(({ id, titleHe, titleEn }) => ({ id, titleHe, titleEn })));
    if (!c.notHelpful) await this.stats?.record({ outcome: verdict.kind, at: this.now().toISOString() });
    if (verdict.kind === "off_topic") return null;
    if (verdict.kind === "answered" && !c.notHelpful) return null;

    const reason: GapReason = c.notHelpful ? "not_helpful" : verdict.kind === "partial" ? "partial" : "no_info";
    const at = this.now().toISOString();
    const example = { question: c.question.slice(0, 500), lang: c.lang, reason, askedAt: at };

    const match = verdict.matchesGapId ? all.find((g) => g.id === verdict.matchesGapId) : undefined;
    if (match) {
      // A dismissed gap stays dismissed: it is counted, but never comes back to the list.
      match.count += 1;
      match.lastAskedAt = at;
      match.examples = [example, ...match.examples].slice(0, MAX_EXAMPLES);
      await this.store.save(match);
      return match;
    }

    const title = (s: string) => s.trim().slice(0, 120);
    const gap: Gap = {
      id: this.newId(),
      titleHe: title(verdict.gapTitleHe) || title(verdict.gapTitleEn) || c.question.slice(0, 120),
      titleEn: title(verdict.gapTitleEn) || title(verdict.gapTitleHe) || c.question.slice(0, 120),
      status: "open",
      count: 1,
      examples: [example],
      firstAskedAt: at,
      lastAskedAt: at,
    };
    await this.store.save(gap);
    return gap;
  }

  async list() {
    return (await this.store.list("open")).sort((a, b) => b.count - a.count || b.lastAskedAt.localeCompare(a.lastAskedAt));
  }

  async setStatus(id: string, status: Gap["status"]): Promise<Gap | undefined> {
    const gap = await this.store.get(id);
    if (!gap) return undefined;
    gap.status = status;
    await this.store.save(gap);
    return gap;
  }
}
