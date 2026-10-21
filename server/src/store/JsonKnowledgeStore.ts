import { readFile } from "node:fs/promises";
import type { KnowledgeFilter, KnowledgeItem, Lang, StoredKnowledgeItem } from "../types.js";
import type { KnowledgeStore } from "./KnowledgeStore.js";
import { localize, queryKnowledge } from "../knowledgeQuery.js";
import type { Persist } from "../reports/collections.js";

export interface ArchiveEntry {
  id: string;
  archivedAt: string;
  /** gaps that reopened when this was removed - they close again on restore */
  reopenedGapIds?: string[];
}

/**
 * Sample knowledge (read-only file in the repo) + uploaded documents (their own file) + an archive list.
 * Keeping uploads separate means the sample data can be removed later without touching real documents.
 */
export class JsonKnowledgeStore implements KnowledgeStore {
  private samples: StoredKnowledgeItem[] | null = null;
  private readonly sampleFile: string;
  private readonly uploads: Persist<StoredKnowledgeItem> | null;
  private readonly archived: Persist<ArchiveEntry> | null;

  constructor(sampleFile: string, uploads: Persist<StoredKnowledgeItem> | null = null, archived: Persist<ArchiveEntry> | null = null) {
    this.sampleFile = sampleFile;
    this.uploads = uploads;
    this.archived = archived;
  }

  private async all(): Promise<StoredKnowledgeItem[]> {
    this.samples ??= JSON.parse(await readFile(this.sampleFile, "utf8")) as StoredKnowledgeItem[];
    return [...(this.uploads ? await this.uploads.read() : []), ...this.samples];
  }

  private async archivedIds() {
    return new Set((this.archived ? await this.archived.read() : []).map((a) => a.id));
  }

  /** Only documents that are in the knowledge base now. */
  private async live() {
    const gone = await this.archivedIds();
    return (await this.all()).filter((i) => !gone.has(i.id));
  }

  async list(filter: KnowledgeFilter = {}): Promise<KnowledgeItem[]> {
    return queryKnowledge(await this.live(), filter);
  }

  /** Also finds removed documents (marked archived), so old links still open. */
  async get(id: string, lang?: Lang): Promise<KnowledgeItem | undefined> {
    const item = (await this.all()).find((i) => i.id === id);
    if (!item) return undefined;
    const out = localize(item, lang);
    return (await this.archivedIds()).has(id) ? { ...out, archived: true } : out;
  }

  async listArchived(lang?: Lang) {
    const entries = this.archived ? await this.archived.read() : [];
    const byId = new Map((await this.all()).map((i) => [i.id, i]));
    return entries
      .sort((a, b) => b.archivedAt.localeCompare(a.archivedAt))
      .flatMap((e) => (byId.has(e.id) ? [{ ...localize(byId.get(e.id)!, lang), archived: true }] : []));
  }

  async version() {
    const up = this.uploads ? await this.uploads.read() : [];
    const ar = this.archived ? await this.archived.read() : [];
    return `${up.length}:${up.at(-1)?.id ?? ""}:${ar.length}:${ar.at(-1)?.id ?? ""}`;
  }

  async add(item: StoredKnowledgeItem) {
    if (!this.uploads) throw new Error("this knowledge store is read-only");
    const all = await this.uploads.read();
    await this.uploads.write([...all.filter((i) => i.id !== item.id), item]);
  }

  async archive(id: string) {
    if (!this.archived) throw new Error("this knowledge store has no archive");
    if (!(await this.all()).some((i) => i.id === id)) return false;
    const list = await this.archived.read();
    if (!list.some((a) => a.id === id)) await this.archived.write([...list, { id, archivedAt: new Date().toISOString() }]);
    return true;
  }

  async restore(id: string): Promise<false | { reopenedGapIds: string[] }> {
    if (!this.archived) return false;
    const list = await this.archived.read();
    const entry = list.find((a) => a.id === id);
    if (!entry) return false;
    // a restore changes the version too, so remembered answers are rebuilt
    await this.archived.write(list.filter((a) => a.id !== id));
    return { reopenedGapIds: entry.reopenedGapIds ?? [] };
  }

  async noteReopened(id: string, gapIds: string[]) {
    if (!this.archived || !gapIds.length) return;
    const list = await this.archived.read();
    const entry = list.find((a) => a.id === id);
    if (entry) {
      entry.reopenedGapIds = gapIds;
      await this.archived.write(list);
    }
  }
}
