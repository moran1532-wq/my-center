import type { KnowledgeItem } from "../types.js";

/** Hebrew one-letter prefixes: ו ה ב ל מ ש כ ("והתראה", "בסוללה", "שהמים"). */
const PREFIX = /^[והבלמשכ]+/;
const NIQQUD = /[֑-ׇ]/g;
const STOP = new Set([
  "את", "של", "על", "עם", "זה", "זו", "מה", "איך", "למה", "מתי", "יש", "אין", "אם", "או", "גם", "כל", "לא", "כן", "הוא", "היא", "אני", "אנחנו",
  "the", "a", "an", "of", "to", "in", "on", "and", "or", "is", "are", "what", "how", "why", "when", "do", "does", "i", "we", "it", "for", "with",
]);

/** Words for search. Hebrew words are indexed both as written and without one-letter prefixes. */
export function terms(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().replace(NIQQUD, "").split(/[^\p{L}\p{N}]+/u)) {
    if (!raw || STOP.has(raw)) continue;
    out.push(raw);
    if (/[א-ת]/.test(raw) && raw.length > 3) {
      const bare = raw.replace(PREFIX, "");
      if (bare.length >= 2 && bare !== raw) out.push(bare);
      // also try dropping just one letter: "בסוללה" -> "סוללה" when the full strip went too far
      const one = raw.slice(1);
      if (/^[והבלמשכ]/.test(raw) && one !== bare && one.length >= 2) out.push(one);
    }
  }
  return out;
}

export interface SearchDoc {
  id: string;
  /** all text of the document in every language, joined */
  text: string;
  /** words in the title count more */
  title: string;
}

/** BM25 ranking. Returns ids, best first, with scores. */
export function rank(query: string, docs: SearchDoc[]): { id: string; score: number }[] {
  const k1 = 1.4;
  const b = 0.75;
  const index = docs.map((d) => {
    const words = [...terms(d.text), ...terms(d.title), ...terms(d.title)]; // title counted three times
    const tf = new Map<string, number>();
    for (const w of words) tf.set(w, (tf.get(w) ?? 0) + 1);
    return { id: d.id, tf, len: words.length };
  });
  const avg = index.reduce((s, d) => s + d.len, 0) / Math.max(1, index.length);
  const df = new Map<string, number>();
  for (const d of index) for (const w of d.tf.keys()) df.set(w, (df.get(w) ?? 0) + 1);
  const q = [...new Set(terms(query))];
  return index
    .map((d) => {
      let score = 0;
      for (const w of q) {
        const f = d.tf.get(w);
        if (!f) continue;
        const idf = Math.log(1 + (index.length - df.get(w)! + 0.5) / (df.get(w)! + 0.5));
        score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / avg)));
      }
      return { id: d.id, score };
    })
    .sort((a, b2) => b2.score - a.score);
}

export interface PickOptions {
  /** most documents Claude gets */
  max: number;
  /** below this many documents, Claude reads all of them */
  allBelow: number;
}
export const DEFAULT_PICK: PickOptions = { max: 6, allBelow: 20 };

/**
 * Which documents Claude reads for a question.
 * `docs` are in the screen language; `otherLang` holds the same documents in the other language, so a
 * Hebrew question finds an English document and the other way round.
 */
export function pickRelevant(question: string, docs: KnowledgeItem[], otherLang: KnowledgeItem[], opts = DEFAULT_PICK): KnowledgeItem[] {
  if (docs.length < opts.allBelow) return docs;
  const other = new Map(otherLang.map((d) => [d.id, d]));
  const searchDocs = docs.map((d) => {
    const o = other.get(d.id);
    return { id: d.id, title: `${d.title} ${o?.title ?? ""} ${d.topic} ${o?.topic ?? ""}`, text: `${d.body}\n${o?.body ?? ""}` };
  });
  const byId = new Map(docs.map((d) => [d.id, d]));
  // always the closest `max` - even when nothing scores, so Claude (not the search) decides there is no answer
  return rank(question, searchDocs).slice(0, opts.max).map((r) => byId.get(r.id)!);
}
