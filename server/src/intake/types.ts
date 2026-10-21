import type { KnowledgeType, Lang } from "../types.js";

export interface Extracted {
  text: string;
  kind: "pdf" | "word" | "html" | "text" | "link" | "paste";
  /** true when the text was cut to the length cap */
  truncated: boolean;
  pageTitle?: string;
}

export interface GapRef {
  id: string;
  titleHe: string;
  titleEn: string;
  questions: string[];
}

export interface IntakeAnalysis {
  titleHe: string;
  titleEn: string;
  type: KnowledgeType;
  topicHe: string;
  topicEn: string;
  sourceLang: Lang;
  /** only when uploading for a specific gap */
  targetGap: { answers: boolean; explanationHe: string; explanationEn: string } | null;
  /** other open gaps this document also answers */
  alsoAnswersGapIds: string[];
}

export type AnalyzeDocument = (text: string, target: GapRef | null, openGaps: GapRef[]) => Promise<IntakeAnalysis>;
export type TranslateDocument = (text: string, to: Lang) => Promise<string>;

export interface Draft {
  id: string;
  createdAt: number;
  extracted: Extracted;
  sourceUrl?: string;
  targetGapId: string | null;
  analysis: IntakeAnalysis;
  /** gaps the document may close: the target (when it answers) and others Claude found */
  suggestedGaps: { id: string; titleHe: string; titleEn: string; isTarget: boolean }[];
}

export interface CommitInput {
  draftId: string;
  titleHe: string;
  titleEn: string;
  type: KnowledgeType;
  topicHe: string;
  topicEn: string;
  /** gaps to close - only gaps Claude found the document answers are accepted */
  closeGapIds: string[];
  /** the owner checked "close anyway" for the gap they uploaded to */
  closeTargetAnyway: boolean;
}
