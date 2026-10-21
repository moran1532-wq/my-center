import type { GapService } from "../gaps/GapService.js";
import type { Mailer, RecipientStore, ReportData, ReportStore, StatsStore } from "./types.js";
import { buildReportHtml, reportSubject } from "./reportHtml.js";
import { nextReportDue, REPORT_EVERY_DAYS } from "./schedule.js";

export interface ReportDeps {
  gaps: GapService;
  stats: StatsStore;
  recipients: RecipientStore;
  reports: ReportStore;
  mailer: Mailer | null;
  newId: () => string;
  now?: () => Date;
}

/** "moran@example.com" -> "m***@example.com", so logs never hold a full address. */
export const maskEmail = (email: string) => email.replace(/^(.).*(@.*)$/, "$1***$2");

/** Builds the gap report, keeps it, and emails it. No Node code - the preview uses it too. */
export class ReportService {
  private readonly d: Required<ReportDeps>;
  private running: Promise<ReportData> | null = null;

  constructor(deps: ReportDeps) {
    this.d = { now: () => new Date(), ...deps };
  }

  /** Only one report is built at a time (a click and the schedule can't double up). */
  generate(trigger: ReportData["trigger"]): Promise<ReportData> {
    this.running ??= this.build(trigger).finally(() => (this.running = null));
    return this.running;
  }

  private async build(trigger: ReportData["trigger"]): Promise<ReportData> {
    const now = this.d.now();
    const previous = (await this.d.reports.list())[0];
    const periodStart = previous?.createdAt ?? new Date(now.getTime() - REPORT_EVERY_DAYS * 86400000).toISOString();

    const stats = await this.d.stats.since(periodStart);
    const count = (o: string) => stats.filter((s) => s.outcome === o).length;
    const gaps = (await this.d.gaps.list()).map((g) => ({ ...g, isNew: !previous || g.firstAskedAt > previous.createdAt }));

    const report: ReportData = {
      id: this.d.newId(),
      createdAt: now.toISOString(),
      periodStart,
      trigger,
      stats: {
        asked: stats.filter((s) => s.outcome !== "off_topic").length,
        answered: count("answered"),
        partial: count("partial"),
        noInfo: count("no_info"),
      },
      gaps,
      delivery: { emailed: [], failed: [], note: "sent" },
    };

    const recipients = await this.d.recipients.list();
    if (!recipients.length) report.delivery.note = "no_recipients";
    else if (!this.d.mailer) report.delivery.note = "no_mail_server";
    else {
      for (const r of recipients) {
        const html = buildReportHtml(report, r.lang);
        try {
          await this.d.mailer.send({
            to: r.email,
            subject: reportSubject(report, r.lang),
            html,
            attachment: { filename: `knowledge-gaps-${report.createdAt.slice(0, 10)}.html`, content: html },
          });
          report.delivery.emailed.push(r.email);
        } catch (e) {
          console.error("report email failed:", maskEmail(r.email), e instanceof Error ? e.message : e);
          report.delivery.failed.push(r.email);
        }
      }
      if (report.delivery.failed.length) report.delivery.note = "partial_failure";
    }

    await this.d.reports.save(report);
    return report;
  }

  list() {
    return this.d.reports.list();
  }

  get(id: string) {
    return this.d.reports.get(id);
  }

  async nextDue(): Promise<Date> {
    const lastScheduled = (await this.d.reports.list()).find((r) => r.trigger === "schedule");
    return nextReportDue(lastScheduled?.createdAt ?? null, this.d.now());
  }

  /** Called by a timer. Sends the scheduled report when it is due. */
  async tick(): Promise<ReportData | null> {
    if (this.d.now() < (await this.nextDue())) return null;
    return this.generate("schedule");
  }
}
