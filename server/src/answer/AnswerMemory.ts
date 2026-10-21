import type { Persist } from "../reports/collections.js";
import type { Lang } from "../types.js";
import type { KnowledgeType } from "../types.js";

// same shapes as AnswerService's - kept here so the preview can use this file without the server code
interface AnswerSegment { text: string; sourceRefs: number[] }
interface AnswerSource { number: number; id: string; title: string; type: KnowledgeType; passages: string[] }
import { terms } from "./search.js";

const PREFIX = /^[והבלמשכ]+/;

export interface MemoryEntry {
  key: string;
  lang: Lang;
  question: string;
  segments: AnswerSegment[];
  sources: AnswerSource[];
  /** knowledge base version the answer was written against */
  version: string;
  createdAt: string;
  hits: number;
  /** what the gap check decided for this question (filled in after the answer) */
  outcome?: "answered" | "partial" | "no_info" | "off_topic";
  gapId?: string | null;
}

const TTL_MS = 30 * 86400000;
const MAX = 2000;

/** "מה עושים בהתראת דליפה?" and "מה עושים בהתראת דליפה" (or the same words in another order) share a key. */
export function memoryKey(question: string, lang: Lang) {
  // one base form per word: "בהתראת" and "התראת" both become "תראת"; short words stay as written
  const base = (w: string) => {
    const bare = w.replace(PREFIX, "");
    return /[\u05D0-\u05EA]/.test(w) && bare.length >= 3 ? bare : w;
  };
  const words = question.split(/\s+/).flatMap((w) => terms(w).slice(0, 1)).map(base);
  return `${lang}:${[...new Set(words)].sort().join(" ")}`;
}

/** Answers to repeated first questions. Emptied whenever the knowledge base changes. No Node code. */
export class AnswerMemory {
  private readonly p: Persist<MemoryEntry>;
  private readonly now: () => Date;
  constructor(p: Persist<MemoryEntry>, now: () => Date = () => new Date()) {
    this.p = p;
    this.now = now;
  }

  private fresh(e: MemoryEntry, version: string) {
    return e.version === version && this.now().getTime() - Date.parse(e.createdAt) < TTL_MS;
  }

  async find(question: string, lang: Lang, version: string): Promise<MemoryEntry | null> {
    const key = memoryKey(question, lang);
    if (key.endsWith(":")) return null; // no real words - don't guess
    const all = await this.p.read();
    const hit = all.find((e) => e.key === key && this.fresh(e, version));
    if (!hit) return null;
    hit.hits += 1;
    await this.p.write(all.filter((e) => this.fresh(e, version)));
    return hit;
  }

  async save(entry: Omit<MemoryEntry, "key" | "createdAt" | "hits">) {
    const key = memoryKey(entry.question, entry.lang);
    if (key.endsWith(":")) return;
    const all = (await this.p.read()).filter((e) => e.key !== key && this.fresh(e, entry.version));
    all.push({ ...entry, key, createdAt: this.now().toISOString(), hits: 0 });
    await this.p.write(all.slice(-MAX));
  }

  async update(question: string, lang: Lang, patch: Partial<Pick<MemoryEntry, "outcome" | "gapId">>) {
    const key = memoryKey(question, lang);
    const all = await this.p.read();
    const e = all.find((x) => x.key === key);
    if (!e) return;
    Object.assign(e, patch);
    await this.p.write(all);
  }

  async forget(question: string, lang: Lang) {
    const key = memoryKey(question, lang);
    await this.p.write((await this.p.read()).filter((e) => e.key !== key));
  }
}
