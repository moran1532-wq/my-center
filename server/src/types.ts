export type KnowledgeType = "procedure" | "document" | "customer_answer";

export interface KnowledgeItem {
  id: string;
  title: string;
  type: KnowledgeType;
  topic: string;
  updatedAt: string; // YYYY-MM-DD
  owner: string;
  isSample: boolean;
  body: string; // plain text, paragraphs separated by blank lines
}

export interface KnowledgeFilter {
  type?: KnowledgeType;
  q?: string;
}
