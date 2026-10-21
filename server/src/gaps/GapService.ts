import type { AnalyzeGap, Gap, GapCandidate, GapReason, GapStore, GapVerdict } from "./types.js";
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
  consider(candidate: GapCandidate, onVerdict?: (kind: GapVerdict["kind"]) => void): Promise<Gap | null> {
    const run = this.queue.then(() => this.considerNow(candidate, onVerdict));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async considerNow(c: GapCandidate, onVerdict?: (kind: GapVerdict["kind"]) => void): Promise<Gap | null> {
    const all = await this.store.list();
    const verdict = await this.analyze(c, all.map(({ id, titleHe, titleEn }) => ({ id, titleHe, titleEn })));
    onVerdict?.(verdict.kind);
    if (!c.notHelpful) await this.stats?.record({ outcome: verdict.kind, at: this.now().toISOString() });
    if (verdict.kind === "off_topic") return null;
    if (verdict.kind === "answered" && !c.notHelpful) return null;

    const reason: GapReason = c.notHelpful ? "not_helpful" : verdict.kind === "partial" ? "partial" : "no_info";
    const at = this.now().toISOString();
    const example = { question: c.question.slice(0, 500), lang: c.lang, reason, askedAt: at };

    const match = verdict.matchesGapId ? all.find((g) => g.id === verdict.matchesGapId) : undefined;
    if (match) {
      // A dismissed gap stays dismissed: it is counted, but never comes back to the list.
      // A closed gap that is asked again was not really answered - it reopens.
      if (match.status === "closed") {
        match.status = "open";
        delete match.closedAt;
        delete match.closedByItemId;
      }
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

  /** Claude already said how well the answer covered the question - count it without a second call. */
  async recordOutcome(outcome: "answered" | "off_topic") {
    await this.stats?.record({ outcome, at: this.now().toISOString() });
  }

  /**
   * The same question was answered from memory. If it was a gap, count it on that gap (no Claude call).
   * Returns the gap, or null when the remembered answer wasn't a gap or the gap is gone.
   */
  async recordRepeat(c: GapCandidate, remembered: { outcome?: "answered" | "partial" | "no_info" | "off_topic"; gapId?: string | null }) {
    if (!remembered.outcome) return null;
    const at = this.now().toISOString();
    await this.stats?.record({ outcome: remembered.outcome, at });
    if (!remembered.gapId) return null;
    const run = this.queue.then(async () => {
      const gap = await this.store.get(remembered.gapId!);
      if (!gap) return null;
      gap.count += 1;
      gap.lastAskedAt = at;
      const reason: GapReason = remembered.outcome === "partial" ? "partial" : "no_info";
      gap.examples = [{ question: c.question.slice(0, 500), lang: c.lang, reason, askedAt: at }, ...gap.examples].slice(0, MAX_EXAMPLES);
      await this.store.save(gap);
      return gap;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Analyse and also return what was decided, for the answer memory. */
  async considerWithOutcome(c: GapCandidate): Promise<{ gap: Gap | null; outcome: GapVerdict["kind"] }> {
    let outcome: GapVerdict["kind"] = "answered";
    const gap = await this.consider(c, (k) => (outcome = k));
    return { gap, outcome };
  }

  async listClosed() {
    return (await this.store.list("closed")).sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? ""));
  }

  /** A document answered this gap. */
  async close(id: string, itemId: string): Promise<Gap | undefined> {
    const gap = await this.store.get(id);
    if (!gap || gap.status !== "open") return undefined;
    gap.status = "closed";
    gap.closedAt = this.now().toISOString();
    gap.closedByItemId = itemId;
    await this.store.save(gap);
    return gap;
  }

  /** The document that closed these gaps was removed - the gaps are open again. */
  async reopenClosedBy(itemId: string): Promise<Gap[]> {
    const reopened: Gap[] = [];
    for (const g of await this.store.list("closed")) {
      if (g.closedByItemId !== itemId) continue;
      g.status = "open";
      delete g.closedAt;
      delete g.closedByItemId;
      await this.store.save(g);
      reopened.push(g);
    }
    return reopened;
  }

  async get(id: string) {
    return this.store.get(id);
  }

  async setStatus(id: string, status: "open" | "dismissed"): Promise<Gap | undefined> {
    const gap = await this.store.get(id);
    if (!gap) return undefined;
    gap.status = status;
    await this.store.save(gap);
    return gap;
  }
}
