// Preview only (VITE_DEMO): answers come from Claude through the claude.ai page
// runtime, on the viewer's own account. The real system uses the server instead.
import type { AskResult, AnswerSource, KnowledgeItem } from "./api";

interface SampleFn {
  json<T>(input: { role: "user" | "assistant"; content: string }[], opts?: object): Promise<T>;
}
declare global {
  interface Window {
    claude?: { use(name: "sample"): Promise<SampleFn | null> };
  }
}

interface Reply {
  segments: { text: string; sources: number[] }[];
  quotes: { doc: number; quote: string }[];
}

const conversations = new Map<string, { docs: KnowledgeItem[]; turns: { role: "user" | "assistant"; content: string }[] }>();

const RULES = `You are the knowledge assistant of a water-technology company's internal team. Answer ONLY from the numbered documents below.
- Never use outside knowledge or guess numbers, steps or policies.
- Give a complete answer that resolves the question, so the reader does not need to open the document. Give steps when the documents have steps.
- If the documents cover only part of the question, answer that part and say clearly which part is not in the knowledge base.
- If nothing answers it, say plainly that the knowledge base has no information on it.
- Answer in the language the question is written in.
- Plain text, numbered lines for steps, no markdown.

Reply with only JSON in this shape:
{"segments":[{"text":"part of the answer","sources":[0]}],"quotes":[{"doc":0,"quote":"an exact sentence copied character for character from document 0"}]}
"sources" lists the document numbers that support that part ([] when none). "quotes" holds 1-3 exact passages per document you used.`;

export class DemoAskError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

export async function demoAsk(question: string, docs: KnowledgeItem[], conversationId?: string): Promise<AskResult> {
  const sample = await window.claude?.use("sample");
  if (!sample) throw new DemoAskError("no_key");

  let conv = conversationId ? conversations.get(conversationId) : undefined;
  if (conversationId && !conv) throw new DemoAskError("conversation_expired");
  const id = conversationId ?? crypto.randomUUID();
  if (!conv) {
    conv = { docs, turns: [] };
    conversations.set(id, conv);
  }
  const library = conv.docs.map((d, i) => `=== Document ${i}: ${d.title} (${d.type}, topic: ${d.topic}) ===\n${d.body}`).join("\n\n");
  conv.turns.push({ role: "user", content: question });

  let reply: Reply;
  try {
    reply = await sample.json<Reply>([{ role: "user", content: `${RULES}\n\n${library}` }, ...conv.turns], { cache: false });
  } catch (e) {
    conv.turns.pop();
    const code = (e as { code?: string }).code;
    throw new DemoAskError(code === "rate_limited" ? "busy" : code === "not_granted" || code === "sampling_disabled" ? "no_key" : "unknown");
  }

  // Keep only quotes that really appear in the document - the same guarantee real citations give.
  const sources: AnswerSource[] = [];
  const numberOf = new Map<number, number>();
  for (const q of reply.quotes ?? []) {
    const doc = conv.docs[q.doc];
    const quote = String(q.quote ?? "").trim();
    if (!doc || !quote || !doc.body.includes(quote)) continue;
    let s = sources.find((x) => x.id === doc.id);
    if (!s) {
      if (sources.length >= 3) continue;
      s = { number: sources.length + 1, id: doc.id, title: doc.title, type: doc.type, passages: [] };
      numberOf.set(q.doc, s.number);
      sources.push(s);
    }
    if (s.passages.length < 3 && !s.passages.includes(quote)) s.passages.push(quote);
  }
  const segments = (reply.segments ?? []).map((seg) => ({
    text: String(seg.text ?? ""),
    sourceRefs: [...new Set((seg.sources ?? []).map((n) => numberOf.get(n)).filter((n): n is number => !!n))].sort(),
  }));
  conv.turns.push({ role: "assistant", content: segments.map((s) => s.text).join("") || "-" });
  return { conversationId: id, status: "answered", segments, sources };
}
