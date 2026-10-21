import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Gap, GapStatus, GapStore } from "./types.js";

/** Keeps gaps in a JSON file so they survive restarts. Writes are atomic (temp file + rename). */
export class JsonGapStore implements GapStore {
  private gaps: Map<string, Gap> | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  private async load() {
    if (!this.gaps) {
      let items: Gap[] = [];
      try {
        items = JSON.parse(await readFile(this.filePath, "utf8"));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      this.gaps = new Map(items.map((g) => [g.id, g]));
    }
    return this.gaps;
  }

  async list(status?: GapStatus) {
    return [...(await this.load()).values()].filter((g) => !status || g.status === status).map((g) => structuredClone(g));
  }

  async get(id: string) {
    const g = (await this.load()).get(id);
    return g && structuredClone(g);
  }

  async save(gap: Gap) {
    (await this.load()).set(gap.id, structuredClone(gap));
    const snapshot = JSON.stringify([...this.gaps!.values()], null, 2);
    this.writing = this.writing.then(async () => {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      await writeFile(tmp, snapshot, "utf8");
      await rename(tmp, this.filePath);
    });
    await this.writing;
  }
}

export class MemoryGapStore implements GapStore {
  private gaps = new Map<string, Gap>();
  async list(status?: GapStatus) {
    return [...this.gaps.values()].filter((g) => !status || g.status === status).map((g) => structuredClone(g));
  }
  async get(id: string) {
    const g = this.gaps.get(id);
    return g && structuredClone(g);
  }
  async save(gap: Gap) {
    this.gaps.set(gap.id, structuredClone(gap));
  }
}
