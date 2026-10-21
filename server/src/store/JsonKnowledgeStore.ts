import { readFile } from "node:fs/promises";
import type { KnowledgeFilter, KnowledgeItem } from "../types.js";
import type { KnowledgeStore } from "./KnowledgeStore.js";

export class JsonKnowledgeStore implements KnowledgeStore {
  private items: KnowledgeItem[] | null = null;

  constructor(private readonly filePath: string) {}

  private async load(): Promise<KnowledgeItem[]> {
    if (!this.items) {
      this.items = JSON.parse(await readFile(this.filePath, "utf8")) as KnowledgeItem[];
    }
    return this.items;
  }

  async list(filter: KnowledgeFilter = {}): Promise<KnowledgeItem[]> {
    const q = filter.q?.trim().toLowerCase();
    return (await this.load())
      .filter((i) => !filter.type || i.type === filter.type)
      .filter(
        (i) =>
          !q ||
          [i.title, i.topic, i.body, i.owner].some((f) => f.toLowerCase().includes(q)),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id: string): Promise<KnowledgeItem | undefined> {
    return (await this.load()).find((i) => i.id === id);
  }
}
