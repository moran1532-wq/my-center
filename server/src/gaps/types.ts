import type { Lang } from "../types.js";

export type GapReason = "no_info" | "partial" | "not_helpful";
export type GapStatus = "open" | "dismissed" | "closed";

export interface GapExample {
  question: string;
  lang: Lang;
  reason: GapReason;
  askedAt: string; // ISO
}

export interface Gap {
  id: string;
  titleHe: string;
  titleEn: string;
  status: GapStatus;
  count: number;
  examples: GapExample[]; // newest first, at most MAX_EXAMPLES
  firstAskedAt: string;
  lastAskedAt: string;
  /** set when a document closed the gap */
  closedAt?: string;
  closedByItemId?: string;
}

/** What the analyzer decides about one question. */
export interface GapVerdict {
  kind: "answered" | "partial" | "no_info" | "off_topic";
  gapTitleHe: string;
  gapTitleEn: string;
  /** id of an existing gap (open or dismissed) this is the same topic as */
  matchesGapId: string | null;
}

export interface GapCandidate {
  question: string;
  answerText: string;
  lang: Lang;
  /** the employee pressed "didn't help" */
  notHelpful: boolean;
}

export type AnalyzeGap = (candidate: GapCandidate, existing: Pick<Gap, "id" | "titleHe" | "titleEn">[]) => Promise<GapVerdict>;

export interface GapStore {
  list(status?: GapStatus): Promise<Gap[]>;
  get(id: string): Promise<Gap | undefined>;
  save(gap: Gap): Promise<void>;
}
