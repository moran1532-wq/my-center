import { describe, it, expect } from "vitest";
import request from "supertest";
import path from "node:path";
import { SMTPServer } from "smtp-server";
import { simpleParser } from "mailparser";
import { next0800, nextReportDue } from "../src/reports/schedule.js";
import { buildReportHtml } from "../src/reports/reportHtml.js";
import { ReportService } from "../src/reports/ReportService.js";
import { MemoryPersist, PersistedRecipients, PersistedReports, PersistedStats } from "../src/reports/collections.js";
import { smtpMailerFromEnv } from "../src/reports/smtpMailer.js";
import type { Mailer, OutgoingMail, ReportData } from "../src/reports/types.js";
import { GapService } from "../src/gaps/GapService.js";
import { MemoryGapStore } from "../src/gaps/JsonGapStore.js";
import type { GapVerdict } from "../src/gaps/types.js";
import { createApp } from "../src/app.js";
import { JsonKnowledgeStore } from "../src/store/JsonKnowledgeStore.js";

let n = 0;
const ids = () => `id${++n}`;

describe("schedule", () => {
  it("08:00 Israel time in winter (UTC+2) and summer (UTC+3)", () => {
    expect(next0800(new Date("2026-12-01T03:00:00Z")).toISOString()).toBe("2026-12-01T06:00:00.000Z");
    expect(next0800(new Date("2026-07-01T03:00:00Z")).toISOString()).toBe("2026-07-01T05:00:00.000Z");
    expect(next0800(new Date("2026-07-01T05:00:01Z")).toISOString()).toBe("2026-07-02T05:00:00.000Z");
  });

  it("every 3 days, even when the last one went out a little after 08:00", () => {
    expect(nextReportDue("2026-12-01T06:00:40Z", new Date("2026-12-01T07:00:00Z")).toISOString()).toBe("2026-12-04T06:00:00.000Z");
    expect(nextReportDue(null, new Date("2026-12-01T09:00:00Z")).toISOString()).toBe("2026-12-02T06:00:00.000Z");
  });
});

function setup(opts: { mailer?: Mailer | null; now?: () => Date } = {}) {
  let clock = Date.parse("2026-12-01T06:00:00Z");
  const now = opts.now ?? (() => new Date(clock));
  const gapStore = new MemoryGapStore();
  const stats = new PersistedStats(new MemoryPersist());
  const verdicts: Partial<GapVerdict>[] = [];
  const gaps = new GapService(async () => ({ kind: "no_info", gapTitleHe: "מחיר יחידה", gapTitleEn: "Unit price", matchesGapId: null, ...verdicts.shift() }),
    gapStore, ids, now).withStats(stats);
  const recipients = new PersistedRecipients(new MemoryPersist(), ids);
  const reports = new PersistedReports(new MemoryPersist());
  const service = new ReportService({ gaps, stats, recipients, reports, mailer: opts.mailer ?? null, newId: ids, now });
  return { gaps, stats, recipients, service, verdicts, advance: (ms: number) => (clock += ms) };
}

const q = (question: string) => ({ question, answerText: "", lang: "he" as const, notHelpful: false });

describe("report", () => {
  it("counts outcomes, lists open gaps, marks new ones since the last report", async () => {
    const t = setup();
    t.verdicts.push({ kind: "answered" }, { kind: "partial", gapTitleHe: "עלות החלפה", gapTitleEn: "Replacement cost" }, {}, { kind: "off_topic" });
    for (const x of ["a", "b", "c", "d"]) await t.gaps.consider(q(x));
    const first = await t.service.generate("manual");
    expect(first.stats).toEqual({ asked: 3, answered: 1, partial: 1, noInfo: 1 });
    expect(first.gaps.map((g) => g.isNew)).toEqual([true, true]);
    expect(first.delivery.note).toBe("no_recipients");

    t.advance(3600_000);
    t.verdicts.push({ gapTitleHe: "אחריות", gapTitleEn: "Warranty" });
    await t.gaps.consider(q("מה האחריות?"));
    const second = await t.service.generate("manual");
    expect(second.stats.asked).toBe(1);
    expect(second.gaps.find((g) => g.titleEn === "Warranty")!.isNew).toBe(true);
    expect(second.gaps.filter((g) => !g.isNew)).toHaveLength(2);
  });

  it("emails each owner in their language; one failure does not stop the others", async () => {
    const sent: OutgoingMail[] = [];
    const mailer: Mailer = { async send(m) { if (m.to.startsWith("bad")) throw new Error("rejected"); sent.push(m); } };
    const t = setup({ mailer });
    await t.gaps.consider(q("כמה עולה?"));
    await t.recipients.add({ name: "מורן", email: "moran@example.com", lang: "he" });
    await t.recipients.add({ name: "Dana", email: "dana@example.com", lang: "en" });
    await t.recipients.add({ name: "X", email: "bad@example.com", lang: "he" });
    const r = await t.service.generate("manual");
    expect(r.delivery).toEqual({ emailed: ["moran@example.com", "dana@example.com"], failed: ["bad@example.com"], note: "partial_failure" });
    expect(sent[0].subject).toContain("דוח פערי ידע");
    expect(sent[0].html).toContain('dir="rtl"');
    expect(sent[1].subject).toContain("Knowledge gap report");
    expect(sent[1].html).toContain("Unit price");
    expect(sent[1].attachment.filename).toMatch(/^knowledge-gaps-2026-12-01\.html$/);
  });

  it("without a mail server the report is saved and marked", async () => {
    const t = setup();
    await t.recipients.add({ name: "מורן", email: "moran@example.com", lang: "he" });
    expect((await t.service.generate("manual")).delivery.note).toBe("no_mail_server");
  });

  it("the timer sends once when due, not again until 3 days later", async () => {
    const t = setup();
    expect(await t.service.tick()).not.toBeNull(); // first 08:00
    t.advance(10 * 60_000);
    expect(await t.service.tick()).toBeNull();
    t.advance(3 * 86400_000);
    expect((await t.service.tick())?.trigger).toBe("schedule");
  });

  it("a manual report doesn't move the schedule", async () => {
    const t = setup();
    await t.service.tick();
    t.advance(86400_000);
    await t.service.generate("manual");
    expect((await t.service.nextDue()).toISOString()).toBe("2026-12-04T06:00:00.000Z");
  });

  it("escapes question text so it cannot inject HTML", () => {
    const r: ReportData = {
      id: "r", createdAt: "2026-12-01T06:00:00Z", periodStart: "2026-11-28T06:00:00Z", trigger: "manual",
      stats: { asked: 1, answered: 0, partial: 0, noInfo: 1 }, delivery: { emailed: [], failed: [], note: "sent" },
      gaps: [{ id: "g", titleHe: "<b>x</b>", titleEn: "x", status: "open", count: 1, firstAskedAt: "", lastAskedAt: "", isNew: false,
        examples: [{ question: '<script>alert(1)</script>', lang: "he", reason: "no_info", askedAt: "" }] }],
    };
    const html = buildReportHtml(r, "he");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
});

describe("real SMTP delivery", () => {
  it("sends through an SMTP server with the HTML attached", async () => {
    const received: string[] = [];
    const server = new SMTPServer({
      authOptional: true, disabledCommands: ["STARTTLS"],
      onData(stream, _s, cb) { let d = ""; stream.on("data", (c) => (d += c)); stream.on("end", () => { received.push(d); cb(); }); },
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.server.address() as any).port;
    const mailer = smtpMailerFromEnv({ SMTP_HOST: "127.0.0.1", SMTP_PORT: String(port), MAIL_FROM: "kc@example.com", SMTP_SECURE: "false" })!;
    await mailer.send({ to: "moran@example.com", subject: "דוח פערי ידע", html: "<p>שלום</p>", attachment: { filename: "r.html", content: "<p>שלום</p>" } });
    await new Promise<void>((r) => server.close(() => r()));
    const mail = await simpleParser(received[0]);
    expect(mail.subject).toBe("דוח פערי ידע");
    expect(mail.html).toContain("שלום");
    expect(mail.attachments[0].filename).toBe("r.html");
  });

  it("is off when not configured", () => {
    expect(smtpMailerFromEnv({})).toBeNull();
  });
});

describe("report API", () => {
  const store = new JsonKnowledgeStore(path.join(__dirname, "..", "data", "knowledge.json"));
  it("recipients: validates, adds, removes; generate and view a report", async () => {
    const t = setup();
    const app = createApp(store, null, t.gaps, { service: t.service, recipients: t.recipients });
    expect((await request(app).post("/api/recipients").send({ name: "מורן", email: "not-an-email" })).status).toBe(400);
    const added = await request(app).post("/api/recipients").send({ name: "מורן", email: "moran@example.com", lang: "he" });
    expect(added.status).toBe(200);
    expect((await request(app).get("/api/recipients")).body).toHaveLength(1);

    const made = await request(app).post("/api/reports");
    expect(made.body.delivery.note).toBe("no_mail_server");
    const list = await request(app).get("/api/reports");
    expect(list.body.reports).toHaveLength(1);
    expect(list.body.nextDue).toBeTruthy();
    const html = await request(app).get(`/api/reports/${made.body.id}/html?lang=en`);
    expect(html.headers["content-type"]).toContain("text/html");
    expect(html.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(html.text).toContain("Knowledge Gap Report");

    expect((await request(app).delete(`/api/recipients/${added.body.id}`)).status).toBe(200);
    expect((await request(app).delete(`/api/recipients/${added.body.id}`)).status).toBe(404);
  });
});

describe("logs", () => {
  it("mask email addresses", async () => {
    const { maskEmail } = await import("../src/reports/ReportService.js");
    expect(maskEmail("moran@example.com")).toBe("m***@example.com");
  });
});
