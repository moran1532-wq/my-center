import type { KnowledgeItem, Lang } from "../types.js";
import type { KnowledgeStore } from "../store/KnowledgeStore.js";

/** Picks which knowledge items Claude gets to read for a question. */
export interface Retriever {
  documentsFor(question: string, lang: Lang): Promise<KnowledgeItem[]>;
}

/**
 * v1: the knowledge base is small, so Claude reads all of it (and it is cached).
 * When the base grows, replace with a search-based retriever behind the same interface.
 */
export class AllDocumentsRetriever implements Retriever {
  constructor(private readonly store: KnowledgeStore) {}

  async documentsFor(_question: string, lang: Lang): Promise<KnowledgeItem[]> {
    const items = await this.store.list({ lang });
    return Promise.all(items.map(async (i) => (await this.store.get(i.id, lang))!));
  }
}
