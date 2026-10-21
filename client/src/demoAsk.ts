// Preview only (VITE_DEMO): answers come from Claude through the claude.ai page
// runtime, on the viewer's own account. The real system uses the server instead.
import type { AskResult, AnswerSource, KnowledgeItem } from "./api";
import { GapService } from "../../server/src/gaps/GapService";
import { buildAnalyzerPrompt } from "../../server/src/gaps/analyzerPrompt";
import type { AnalyzeGap, Gap, GapStatus, GapStore, GapVerdict } from "../../server/src/gaps/types";
import { ReportService } from "../../server/src/reports/ReportService";
import { PersistedRecipients, PersistedReports, PersistedStats, type Persist } from "../../server/src/reports/collections";
import { buildReportHtml, reportSubject } from "../../server/src/reports/reportHtml";
import type { Recipient, ReportData, QuestionStat } from "../../server/src/reports/types";
import { IntakeService } from "../../server/src/intake/IntakeService";
import { buildIntakePrompt, buildTranslatePrompt } from "../../server/src/intake/intakePrompt";
import type { IntakeAnalysis } from "../../server/src/intake/types";
import type { KnowledgeFilter, Lang as KLang, StoredKnowledgeItem } from "../../server/src/types";
import { localize, queryKnowledge } from "../../server/src/knowledgeQuery";
import type { KnowledgeStore } from "../../server/src/store/KnowledgeStore";
import type { UploadCommit, UploadPreview, UploadSource } from "./api";

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

const RULES = `You are the knowledge assistant of a water-technology company's internal team. Answer ONLY from the numbered documents inside <documents>. The team member's question comes after the documents, inside <question> tags - answer that question.
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
  const library = conv.docs
    .map((d, i) => `<document index="${i}">\n<title>${d.title}</title>\n<type>${d.type}, topic: ${d.topic}</type>\n<content>\n${d.body}\n</content>\n</document>`)
    .join("\n");
  // The question is wrapped in its own tags so it can never be mistaken for part of a document.
  conv.turns.push({ role: "user", content: `<question>\n${question}\n</question>` });

  let reply: Reply;
  try {
    reply = await sample.json<Reply>([{ role: "user", content: `${RULES}\n\n<documents>\n${library}\n</documents>` }, ...conv.turns], { cache: false });
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

/** A list kept in this browser (memory only if storage is blocked). */
class LocalPersist<T> implements Persist<T> {
  private mem: T[] | null = null;
  private readonly key: string;
  constructor(key: string) {
    this.key = key;
  }
  async read(): Promise<T[]> {
    if (!this.mem) {
      try {
        this.mem = JSON.parse(localStorage.getItem(this.key) ?? "[]");
      } catch {
        this.mem = [];
      }
    }
    return structuredClone(this.mem!);
  }
  async write(items: T[]) {
    this.mem = structuredClone(items);
    try {
      localStorage.setItem(this.key, JSON.stringify(items));
    } catch {
      /* memory only */
    }
  }
}

const stats = new PersistedStats(new LocalPersist<QuestionStat>("preview-stats"));
const recipients = new PersistedRecipients(new LocalPersist<Recipient>("preview-recipients"), () => crypto.randomUUID());
const reports = new PersistedReports(new LocalPersist<ReportData>("preview-reports"));

let gapService: GapService | null = null;
export function demoGaps() {
  gapService ??= new GapService(sampleAnalyzer, new LocalGapStore(), () => crypto.randomUUID()).withStats(stats);
  return gapService;
}

export function demoRecipients() {
  return recipients;
}

let reportService: ReportService | null = null;
export function demoReports() {
  reportService ??= new ReportService({ gaps: demoGaps(), stats, recipients, reports, mailer: null, newId: () => crypto.randomUUID() });
  const svc = reportService;
  const summary = (r: ReportData) => ({
    id: r.id, createdAt: r.createdAt, periodStart: r.periodStart, trigger: r.trigger, stats: r.stats,
    gapCount: r.gaps.length, newCount: r.gaps.filter((g) => g.isNew).length, delivery: r.delivery,
    subjects: { he: reportSubject(r, "he"), en: reportSubject(r, "en") },
  });
  const find = async (id: string) => {
    const r = await svc.get(id);
    if (!r) throw new Error("not found");
    return r;
  };
  return {
    async listSummaries() {
      return { reports: (await svc.list()).map(summary), nextDue: (await svc.nextDue()).toISOString() };
    },
    async generate() {
      return summary(await svc.generate("manual"));
    },
    async html(id: string, lang: "he" | "en") {
      return buildReportHtml(await find(id), lang);
    },
  };
}

export async function demoFeedback(conversationId: string, turn: number) {
  await pending.get(`${conversationId}:${turn}`);
  if (counted.has(`${conversationId}:${turn}`)) return;
  const conv = conversations.get(conversationId);
  const users = conv?.turns.flatMap((t, i) => (t.role === "user" ? [i] : [])) ?? [];
  const at = users[turn];
  if (!conv || at === undefined) throw new DemoAskError("conversation_expired");
  await demoGaps().consider({
    question: conv.turns[at].content.replace(/^<question>\n?|\n?<\/question>$/g, ""),
    answerText: conv.turns[at + 1]?.content ?? "",
    lang: conv.lang,
    notHelpful: true,
  });
  counted.add(`${conversationId}:${turn}`);
}

// ---- uploading in the preview: text and HTML only, kept in this browser ----

const uploadsPersist = new LocalPersist<StoredKnowledgeItem>("preview-uploads");
export const demoUploads = () => uploadsPersist.read();

const demoKnowledge: KnowledgeStore = {
  async list(filter?: KnowledgeFilter) {
    const samples = (await import("../../server/data/knowledge.json")).default as StoredKnowledgeItem[];
    return queryKnowledge([...(await uploadsPersist.read()), ...samples], filter);
  },
  async get(id: string, lang?: KLang) {
    const samples = (await import("../../server/data/knowledge.json")).default as StoredKnowledgeItem[];
    const item = [...(await uploadsPersist.read()), ...samples].find((i) => i.id === id);
    return item && localize(item, lang);
  },
  async add(item: StoredKnowledgeItem) {
    const all = await uploadsPersist.read();
    await uploadsPersist.write([...all.filter((i) => i.id !== item.id), item]);
  },
};

async function sampleFn() {
  const sample = await window.claude?.use("sample");
  if (!sample) throw new DemoAskError("demo:unavailable");
  return sample;
}

let intake: IntakeService | null = null;
function demoIntake() {
  intake ??= new IntakeService({
    knowledge: demoKnowledge,
    gaps: demoGaps(),
    newId: () => crypto.randomUUID(),
    analyze: async (text, target, open) => {
      const sample = await sampleFn();
      const v = await sample.json<IntakeAnalysis>([{ role: "user", content: buildIntakePrompt(text, target, open) +
        '\n\nReply with only JSON: {"titleHe":"","titleEn":"","type":"procedure|document|customer_answer","topicHe":"","topicEn":"","sourceLang":"he|en","targetGap":' +
        (target ? '{"answers":true,"explanationHe":"","explanationEn":""}' : "null") + ',"alsoAnswersGapIds":[]}' }], { cache: false });
      const types = ["procedure", "document", "customer_answer"];
      return {
        titleHe: String(v?.titleHe ?? ""), titleEn: String(v?.titleEn ?? ""),
        type: types.includes(v?.type) ? v.type : "document",
        topicHe: String(v?.topicHe ?? ""), topicEn: String(v?.topicEn ?? ""),
        sourceLang: v?.sourceLang === "en" ? "en" : "he",
        targetGap: target && v?.targetGap ? { answers: !!v.targetGap.answers, explanationHe: String(v.targetGap.explanationHe ?? ""), explanationEn: String(v.targetGap.explanationEn ?? "") } : null,
        alsoAnswersGapIds: Array.isArray(v?.alsoAnswersGapIds) ? v.alsoAnswersGapIds.map(String) : [],
      };
    },
    translate: async (text, to) => {
      const sample = (await sampleFn()) as unknown as (input: { role: "user"; content: string }[], o?: object) => Promise<{ text: string }>;
      const { text: out } = await sample([{ role: "user", content: buildTranslatePrompt(text, to) }], { cache: false });
      return out.trim();
    },
  });
  return intake;
}

function textFromHtml(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style,nav,img").forEach((n) => n.remove());
  return (doc.body?.innerText || doc.body?.textContent || "").trim();
}

export async function demoPreviewUpload(src: UploadSource): Promise<UploadPreview> {
  let raw = "";
  let kind: "html" | "text" | "paste" = "paste";
  if (src.file) {
    const ext = src.file.name.toLowerCase().split(".").pop();
    if (src.file.size > 10 * 1024 * 1024) throw new DemoAskError("too_large");
    if (ext === "html" || ext === "htm") { raw = textFromHtml(await src.file.text()); kind = "html"; }
    else if (ext === "txt" || ext === "md") { raw = await src.file.text(); kind = "text"; }
    else throw new DemoAskError("server_only");
  } else if (src.url) throw new DemoAskError("server_only");
  else raw = src.text ?? "";
  const clean = raw.replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) throw new DemoAskError("empty");
  const truncated = clean.length > 60000;
  const text = truncated ? clean.slice(0, 60000) : clean;
  const d = await demoIntake().preview({ extracted: { text, kind, truncated }, gapId: src.gapId ?? null });
  return { draftId: d.id, kind, truncated, excerpt: text.slice(0, 1500), chars: text.length, sourceUrl: null, analysis: d.analysis, suggestedGaps: d.suggestedGaps };
}

export async function demoCommitUpload(c: UploadCommit) {
  try {
    return await demoIntake().commit(c);
  } catch (e) {
    if ((e as Error)?.constructor?.name === "DraftNotFoundError") throw new DemoAskError("draft_expired");
    throw e;
  }
}
