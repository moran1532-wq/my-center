export type KnowledgeType = "procedure" | "document" | "customer_answer";
export type Lang = "he" | "en";

export interface LocalizedText {
  title: string;
  topic: string;
  owner: string;
  body: string; // plain text, paragraphs separated by blank lines
}

/** Stored shape: Hebrew is the main text, other languages live in `translations`. */
export interface StoredKnowledgeItem extends LocalizedText {
  id: string;
  type: KnowledgeType;
  updatedAt: string; // YYYY-MM-DD
  isSample: boolean;
  /** the web page this came from, when uploaded from a link */
  sourceUrl?: string;
  translations?: Partial<Record<Lang, LocalizedText>>;
}

/** Shape returned to the screen: already in the requested language. */
export interface KnowledgeItem extends LocalizedText {
  id: string;
  type: KnowledgeType;
  updatedAt: string;
  isSample: boolean;
  sourceUrl?: string;
  /** removed from the knowledge base by an owner - Claude no longer reads it, it can be restored */
  archived?: boolean;
  lang: Lang;
}

export interface KnowledgeFilter {
  type?: KnowledgeType;
  q?: string;
  lang?: Lang;
}
