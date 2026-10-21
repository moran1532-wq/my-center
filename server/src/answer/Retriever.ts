import type { KnowledgeItem, Lang } from "../types.js";
import type { KnowledgeStore } from "../store/KnowledgeStore.js";
import { DEFAULT_PICK, pickRelevant, type PickOptions } from "./search.js";

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

/** All documents while the base is small; above that, only the most relevant ones. */
export class SmartRetriever implements Retriever {
  private readonly store: KnowledgeStore;
  private readonly opts: PickOptions;
  constructor(store: KnowledgeStore, opts: PickOptions = DEFAULT_PICK) {
    this.store = store;
    this.opts = opts;
  }

  async documentsFor(question: string, lang: Lang): Promise<KnowledgeItem[]> {
    const full = async (l: Lang) => {
      const items = await this.store.list({ lang: l });
      return Promise.all(items.map(async (i) => (await this.store.get(i.id, l))!));
    };
    const docs = await full(lang);
    if (docs.length < this.opts.allBelow) return docs;
    return pickRelevant(question, docs, await full(lang === "he" ? "en" : "he"), this.opts);
  }
}
