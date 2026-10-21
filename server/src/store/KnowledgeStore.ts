import type { KnowledgeFilter, KnowledgeItem } from "../types.js";

/**
 * Storage contract for the knowledge base.
 * Any database (SQL, Mongo, SharePoint...) can be plugged in by implementing this.
 */
export interface KnowledgeStore {
  list(filter?: KnowledgeFilter): Promise<KnowledgeItem[]>;
  get(id: string): Promise<KnowledgeItem | undefined>;
}
