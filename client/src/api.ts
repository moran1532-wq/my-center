import type { KnowledgeItem, KnowledgeType, Lang, StoredKnowledgeItem } from "../../server/src/types";
import { localize, queryKnowledge } from "../../server/src/knowledgeQuery";

export type { KnowledgeItem, KnowledgeType, Lang };
export type KnowledgeSummary = Omit<KnowledgeItem, "body"> & { excerpt: string };

// Demo mode: a static preview with the sample data bundled in, no server needed.
const DEMO = import.meta.env.VITE_DEMO === "1";
const demoData = async (): Promise<StoredKnowledgeItem[]> =>
  (await import("../../server/data/knowledge.json")).default as StoredKnowledgeItem[];

const summarize = ({ body, ...rest }: KnowledgeItem): KnowledgeSummary => ({ ...rest, excerpt: body.slice(0, 160) });

export async function listKnowledge(lang: Lang, type?: KnowledgeType, q?: string): Promise<KnowledgeSummary[]> {
  if (DEMO) return queryKnowledge(await demoData(), { lang, type, q }).map(summarize);
  const params = new URLSearchParams({ lang });
  if (type) params.set("type", type);
  if (q) params.set("q", q);
  const res = await fetch(`/api/knowledge?${params}`);
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

export async function getKnowledge(id: string, lang: Lang): Promise<KnowledgeItem | null> {
  if (DEMO) {
    const item = (await demoData()).find((i) => i.id === id);
    return item ? localize(item, lang) : null;
  }
  const res = await fetch(`/api/knowledge/${encodeURIComponent(id)}?lang=${lang}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

export interface AnswerSegment { text: string; sourceRefs: number[] }
export interface AnswerSource { number: number; id: string; title: string; type: KnowledgeType; passages: string[] }
export interface AskResult {
  conversationId: string;
  status: "answered" | "declined";
  segments: AnswerSegment[];
  sources: AnswerSource[];
}

export class AskError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

export async function ask(question: string, lang: Lang, conversationId?: string): Promise<AskResult> {
  const res = await fetch("/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, lang, conversationId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new AskError(res.status === 429 ? "busy" : body.error ?? "unknown");
  }
  return res.json();
}
