// Preview only (VITE_DEMO): answers come from Claude through the claude.ai page
// runtime, on the viewer's own account. The real system uses the server instead.
import type { AskResult, AnswerSource, KnowledgeItem } from "./api";
import { GapService } from "../../server/src/gaps/GapService";
import { buildAnalyzerPrompt } from "../../server/src/gaps/analyzerPrompt";
import type { AnalyzeGap, Gap, GapStatus, GapStore, GapVerdict } from "../../server/src/gaps/types";

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

const counted = new Set<string>();
const pending = new Map<string, Promise<void>>();

const conversations = new Map<string, { lang: "he" | "en"; docs: KnowledgeItem[]; turns: { role: "user" | "assistant"; content: string }[] }>();

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
  if (!window.claude) throw new DemoAskError("demo:no_runtime");
  const sample = await window.claude.use("sample");
  if (!sample) throw new DemoAskError("demo:unavailable");

  let conv = conversationId ? conversations.get(conversationId) : undefined;
  if (conversationId && !conv) throw new DemoAskError("conversation_expired");
  const id = conversationId ?? crypto.randomUUID();
  if (!conv) {
    conv = { lang: /[\u0590-\u05FF]/.test(question) ? "he" : "en", docs, turns: [] };
    conversations.set(id, conv);
  }
  const library = conv.docs.map((d, i) => `=== Document ${i}: ${d.title} (${d.type}, topic: ${d.topic}) ===\n${d.body}`).join("\n\n");
  conv.turns.push({ role: "user", content: question });

  let reply: Reply;
  try {
    reply = await sample.json<Reply>([{ role: "user", content: `${RULES}\n\n${library}` }, ...conv.turns], { cache: false });
  } catch (e) {
    conv.turns.pop();
    const err = e as { code?: string; message?: string; text?: string };
    console.error("preview ask failed", err.code, err.message, err.text?.slice(0, 500));
    throw new DemoAskError(err.code === "rate_limited" ? "busy" : `demo:${err.code ?? "unknown"}`);
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
  const answerText = segments.map((s) => s.text).join("");
  conv.turns.push({ role: "assistant", content: answerText || "-" });
  const turn = conv.turns.filter((t) => t.role === "user").length - 1;
  const key = `${id}:${turn}`;
  pending.set(key, demoGaps().consider({ question, answerText, lang: conv.lang, notHelpful: false })
    .then((gap) => { if (gap) counted.add(key); })
    .catch((e) => console.error("preview gap check failed", e))
    .finally(() => pending.delete(key)));
  return { conversationId: id, turn, status: "answered", segments, sources };
}

// ---- gaps in the preview: kept in this browser only ----

const KEY = "preview-gaps";

class LocalGapStore implements GapStore {
  private mem: Gap[] | null = null;
  private read(): Gap[] {
    if (this.mem) return this.mem;
    try {
      this.mem = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    } catch {
      this.mem = [];
    }
    return this.mem!;
  }
  async list(status?: GapStatus) {
    return this.read().filter((g) => !status || g.status === status).map((g) => structuredClone(g));
  }
  async get(id: string) {
    const g = this.read().find((x) => x.id === id);
    return g && structuredClone(g);
  }
  async save(gap: Gap) {
    const all = this.read().filter((g) => g.id !== gap.id);
    all.push(structuredClone(gap));
    this.mem = all;
    try {
      localStorage.setItem(KEY, JSON.stringify(all));
    } catch {
      /* storage unavailable: keep in memory for this visit */
    }
  }
}

const sampleAnalyzer: AnalyzeGap = async (candidate, existing) => {
  const sample = await window.claude?.use("sample");
  if (!sample) throw new Error("preview runtime unavailable");
  const v = await sample.json<GapVerdict>(
    [{ role: "user", content: buildAnalyzerPrompt(candidate, existing) +
      '\n\nReply with only JSON: {"kind":"answered|partial|no_info|off_topic","gapTitleHe":"","gapTitleEn":"","matchesGapId":null}' }],
    { cache: false, modelTier: "quick" },
  );
  const kinds = ["answered", "partial", "no_info", "off_topic"];
  return {
    kind: kinds.includes(v?.kind) ? v.kind : "answered",
    gapTitleHe: String(v?.gapTitleHe ?? ""),
    gapTitleEn: String(v?.gapTitleEn ?? ""),
    matchesGapId: typeof v?.matchesGapId === "string" ? v.matchesGapId : null,
  };
};

let gapService: GapService | null = null;
export function demoGaps() {
  gapService ??= new GapService(sampleAnalyzer, new LocalGapStore(), () => crypto.randomUUID());
  return gapService;
}

export async function demoFeedback(conversationId: string, turn: number) {
  await pending.get(`${conversationId}:${turn}`);
  if (counted.has(`${conversationId}:${turn}`)) return;
  const conv = conversations.get(conversationId);
  const users = conv?.turns.flatMap((t, i) => (t.role === "user" ? [i] : [])) ?? [];
  const at = users[turn];
  if (!conv || at === undefined) throw new DemoAskError("conversation_expired");
  await demoGaps().consider({
    question: conv.turns[at].content,
    answerText: conv.turns[at + 1]?.content ?? "",
    lang: conv.lang,
    notHelpful: true,
  });
  counted.add(`${conversationId}:${turn}`);
}
