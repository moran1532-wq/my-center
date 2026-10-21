import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Persist } from "./collections.js";

/** A JSON array in a file. Writes are atomic and one at a time. */
export class JsonFilePersist<T> implements Persist<T> {
  private writing: Promise<void> = Promise.resolve();
  private readonly filePath: string;
  constructor(filePath: string) {
    this.filePath = filePath;
  }
  async read(): Promise<T[]> {
    await this.writing;
    try {
      return JSON.parse(await readFile(this.filePath, "utf8"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
  }
  async write(items: T[]) {
    const text = JSON.stringify(items, null, 2);
    this.writing = this.writing.then(async () => {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      await writeFile(tmp, text, "utf8");
      await rename(tmp, this.filePath);
    });
    await this.writing;
  }
}
