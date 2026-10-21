import type { KnowledgeFilter, KnowledgeItem, Lang, StoredKnowledgeItem } from "./types.js";

/** Returns the item in the requested language, falling back to Hebrew when no translation exists. */
export function localize(item: StoredKnowledgeItem, lang: Lang = "he"): KnowledgeItem {
  const tr = lang === "he" ? undefined : item.translations?.[lang];
  const text = tr ?? item;
  return {
    id: item.id,
    type: item.type,
    updatedAt: item.updatedAt,
    isSample: item.isSample,
    lang: tr ? lang : "he",
    title: text.title,
    topic: text.topic,
    owner: text.owner,
    body: text.body,
  };
}

/** Filters, searches (in the requested language) and sorts newest first. */
export function queryKnowledge(items: StoredKnowledgeItem[], filter: KnowledgeFilter = {}): KnowledgeItem[] {
  const q = filter.q?.trim().toLowerCase();
  return items
    .filter((i) => !filter.type || i.type === filter.type)
    .map((i) => localize(i, filter.lang))
    .filter((i) => !q || [i.title, i.topic, i.body, i.owner].some((f) => f.toLowerCase().includes(q)))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
