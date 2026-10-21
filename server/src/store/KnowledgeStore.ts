import type { KnowledgeFilter, KnowledgeItem, Lang, StoredKnowledgeItem } from "../types.js";

/**
 * Storage contract for the knowledge base.
 * Any database (SQL, Mongo, SharePoint...) can be plugged in by implementing this.
 */
export interface KnowledgeStore {
  list(filter?: KnowledgeFilter): Promise<KnowledgeItem[]>;
  get(id: string, lang?: Lang): Promise<KnowledgeItem | undefined>;
  /** Adds an uploaded document. */
  add(item: StoredKnowledgeItem): Promise<void>;
  /** changes whenever a document is added - remembered answers from an older version are dropped */
  version(): Promise<string>;
  /** Removes a document (kept in an archive so it can be restored). false if not found. */
  archive(id: string): Promise<boolean>;
  /** false if it wasn't removed; otherwise the gaps that reopened when it was removed */
  restore(id: string): Promise<false | { reopenedGapIds: string[] }>;
  /** remember which gaps reopened when a document was removed */
  noteReopened(id: string, gapIds: string[]): Promise<void>;
  listArchived(lang?: Lang): Promise<KnowledgeItem[]>;
}
