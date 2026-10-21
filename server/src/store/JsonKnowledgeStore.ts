import { readFile } from "node:fs/promises";
import type { KnowledgeFilter, KnowledgeItem, Lang, StoredKnowledgeItem } from "../types.js";
import type { KnowledgeStore } from "./KnowledgeStore.js";
import { localize, queryKnowledge } from "../knowledgeQuery.js";
import type { Persist } from "../reports/collections.js";

/**
 * Sample knowledge (read-only file in the repo) + uploaded documents (their own file).
 * Keeping uploads separate means the sample data can be removed later without touching real documents.
 */
export class JsonKnowledgeStore implements KnowledgeStore {
  private samples: StoredKnowledgeItem[] | null = null;
  private readonly sampleFile: string;
  private readonly uploads: Persist<StoredKnowledgeItem> | null;

  constructor(sampleFile: string, uploads: Persist<StoredKnowledgeItem> | null = null) {
    this.sampleFile = sampleFile;
    this.uploads = uploads;
  }

  private async load(): Promise<StoredKnowledgeItem[]> {
    this.samples ??= JSON.parse(await readFile(this.sampleFile, "utf8")) as StoredKnowledgeItem[];
    return [...(this.uploads ? await this.uploads.read() : []), ...this.samples];
  }

  async list(filter: KnowledgeFilter = {}): Promise<KnowledgeItem[]> {
    return queryKnowledge(await this.load(), filter);
  }

  async get(id: string, lang?: Lang): Promise<KnowledgeItem | undefined> {
    const item = (await this.load()).find((i) => i.id === id);
    return item && localize(item, lang);
  }

  async version() {
    const up = this.uploads ? await this.uploads.read() : [];
    return `${up.length}:${up.at(-1)?.id ?? ""}`;
  }

  async add(item: StoredKnowledgeItem) {
    if (!this.uploads) throw new Error("this knowledge store is read-only");
    const all = await this.uploads.read();
    await this.uploads.write([...all.filter((i) => i.id !== item.id), item]);
  }
}
