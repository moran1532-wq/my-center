export type KnowledgeType = "procedure" | "document" | "customer_answer";

export interface KnowledgeSummary {
  id: string;
  title: string;
  type: KnowledgeType;
  topic: string;
  updatedAt: string;
  owner: string;
  isSample: boolean;
  excerpt: string;
}

export interface KnowledgeItem extends Omit<KnowledgeSummary, "excerpt"> {
  body: string;
}

// Demo mode: a static preview with the sample data bundled in, no server needed.
const DEMO = import.meta.env.VITE_DEMO === "1";
const demoData = async (): Promise<KnowledgeItem[]> =>
  (await import("../../server/data/knowledge.json")).default as KnowledgeItem[];

export async function listKnowledge(type?: KnowledgeType, q?: string): Promise<KnowledgeSummary[]> {
  if (DEMO) {
    const needle = q?.trim().toLowerCase();
    return (await demoData())
      .filter((i) => !type || i.type === type)
      .filter((i) => !needle || [i.title, i.topic, i.body, i.owner].some((f) => f.toLowerCase().includes(needle)))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(({ body, ...rest }) => ({ ...rest, excerpt: body.slice(0, 160) }));
  }
  const params = new URLSearchParams();
  if (type) params.set("type", type);
  if (q) params.set("q", q);
  const res = await fetch(`/api/knowledge?${params}`);
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

export async function getKnowledge(id: string): Promise<KnowledgeItem | null> {
  if (DEMO) return (await demoData()).find((i) => i.id === id) ?? null;
  const res = await fetch(`/api/knowledge/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}
