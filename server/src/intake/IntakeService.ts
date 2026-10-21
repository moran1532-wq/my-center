import type { GapService } from "../gaps/GapService.js";
import type { KnowledgeStore } from "../store/KnowledgeStore.js";
import type { StoredKnowledgeItem } from "../types.js";
import type { AnalyzeDocument, CommitInput, Draft, Extracted, GapRef, TranslateDocument } from "./types.js";

const DRAFT_TTL_MS = 60 * 60 * 1000;
const MAX_DRAFTS = 100;

export class DraftNotFoundError extends Error {}

/** Upload in two steps: preview (read + suggest, nothing saved) → commit (translate, save, close gaps). No Node code - the preview uses it too. */
export class IntakeService {
  private readonly drafts = new Map<string, Draft>();
  private readonly analyze: AnalyzeDocument;
  private readonly translate: TranslateDocument;
  private readonly knowledge: KnowledgeStore;
  private readonly gaps: GapService;
  private readonly newId: () => string;
  private readonly now: () => Date;

  constructor(deps: {
    analyze: AnalyzeDocument; translate: TranslateDocument; knowledge: KnowledgeStore; gaps: GapService;
    newId: () => string; now?: () => Date;
  }) {
    this.analyze = deps.analyze;
    this.translate = deps.translate;
    this.knowledge = deps.knowledge;
    this.gaps = deps.gaps;
    this.newId = deps.newId;
    this.now = deps.now ?? (() => new Date());
  }

  private sweep() {
    const cutoff = Date.now() - DRAFT_TTL_MS;
    for (const [id, d] of this.drafts) if (d.createdAt < cutoff) this.drafts.delete(id);
    while (this.drafts.size >= MAX_DRAFTS) this.drafts.delete(this.drafts.keys().next().value!);
  }

  async preview(input: { extracted: Extracted; sourceUrl?: string; gapId?: string | null }): Promise<Draft> {
    this.sweep();
    const open = await this.gaps.list();
    const refs: GapRef[] = open.map((g) => ({ id: g.id, titleHe: g.titleHe, titleEn: g.titleEn, questions: g.examples.map((e) => e.question) }));
    const target = input.gapId ? refs.find((g) => g.id === input.gapId) ?? null : null;
    const analysis = await this.analyze(input.extracted.text, target, refs);

    const known = new Map(open.map((g) => [g.id, g]));
    const suggested: Draft["suggestedGaps"] = [];
    if (target && analysis.targetGap?.answers) suggested.push({ id: target.id, titleHe: target.titleHe, titleEn: target.titleEn, isTarget: true });
    for (const id of new Set(analysis.alsoAnswersGapIds)) {
      const g = known.get(id);
      if (g && id !== target?.id) suggested.push({ id, titleHe: g.titleHe, titleEn: g.titleEn, isTarget: false });
    }

    const draft: Draft = {
      id: this.newId(),
      createdAt: Date.now(),
      extracted: input.extracted,
      ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
      targetGapId: target?.id ?? null,
      analysis,
      suggestedGaps: suggested,
    };
    this.drafts.set(draft.id, draft);
    return draft;
  }

  async commit(input: CommitInput) {
    const draft = this.drafts.get(input.draftId);
    if (!draft) throw new DraftNotFoundError();

    const original = draft.extracted.text;
    const from = draft.analysis.sourceLang;
    const translated = await this.translate(original, from === "he" ? "en" : "he");
    const bodyHe = from === "he" ? original : translated;
    const bodyEn = from === "he" ? translated : original;

    const clip = (s: string, n: number) => s.trim().slice(0, n);
    const item: StoredKnowledgeItem = {
      id: `up-${this.newId()}`,
      type: input.type,
      updatedAt: this.now().toISOString().slice(0, 10),
      isSample: false,
      ...(draft.sourceUrl ? { sourceUrl: draft.sourceUrl } : {}),
      title: clip(input.titleHe, 200) || clip(input.titleEn, 200),
      topic: clip(input.topicHe, 60) || clip(input.topicEn, 60),
      owner: "אחראי ידע",
      body: bodyHe,
      translations: {
        en: {
          title: clip(input.titleEn, 200) || clip(input.titleHe, 200),
          topic: clip(input.topicEn, 60) || clip(input.topicHe, 60),
          owner: "Knowledge owner",
          body: bodyEn,
        },
      },
    };
    await this.knowledge.add(item);
    this.drafts.delete(draft.id);

    const closed = [];
    for (const id of new Set(input.closeGapIds)) {
      const g = await this.gaps.close(id, item.id);
      if (g) closed.push({ id: g.id, titleHe: g.titleHe, titleEn: g.titleEn });
    }
    return { itemId: item.id, closed };
  }
}
