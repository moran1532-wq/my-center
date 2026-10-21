import { readFile } from "node:fs/promises";
import type { KnowledgeFilter, KnowledgeItem, Lang, StoredKnowledgeItem } from "../types.js";
import type { KnowledgeStore } from "./KnowledgeStore.js";
import { localize, queryKnowledge } from "../knowledgeQuery.js";

export class JsonKnowledgeStore implements KnowledgeStore {
  private items: StoredKnowledgeItem[] | null = null;

  constructor(private readonly filePath: string) {}

  private async load(): Promise<StoredKnowledgeItem[]> {
    if (!this.items) {
      this.items = JSON.parse(await readFile(this.filePath, "utf8")) as StoredKnowledgeItem[];
    }
    return this.items;
  }

  async list(filter: KnowledgeFilter = {}): Promise<KnowledgeItem[]> {
    return queryKnowledge(await this.load(), filter);
  }

  async get(id: string, lang?: Lang): Promise<KnowledgeItem | undefined> {
    const item = (await this.load()).find((i) => i.id === id);
    return item && localize(item, lang);
  }
}
