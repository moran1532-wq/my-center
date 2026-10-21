import type { Lang } from "../types.js";
import type { ReportData } from "./types.js";

const T = {
  he: {
    title: "דוח פערי ידע",
    period: (a: string, b: string) => `התקופה: ${a} - ${b}`,
    asked: "שאלות נשאלו",
    answered: "נענו במלואן",
    partial: "נענו חלקית",
    noInfo: "בלי מידע",
    gapsHeading: (n: number) => (n === 1 ? "פער פתוח אחד" : `${n} פערים פתוחים, מהנשאל ביותר`),
    none: "אין פערים פתוחים. כל השאלות קיבלו מענה מהמאגר.",
    times: (n: number) => (n === 1 ? "נשאל פעם אחת" : `נשאל ${n} פעמים`),
    isNew: "חדש",
    howAsked: "איך שאלו:",
    reasons: { no_info: "אין מידע", partial: "תשובה חלקית", not_helpful: "לא עזר" },
    closedHeading: (n: number) => (n === 1 ? "פער אחד נסגר מאז הדוח הקודם" : `${n} פערים נסגרו מאז הדוח הקודם`),
    footer: "כדי לסגור פער - מעלים מסמך שעונה עליו. בפעם הבאה שמישהו ישאל, תהיה תשובה.",
    subject: (n: number, d: string) => `דוח פערי ידע - ${n === 1 ? "פער פתוח אחד" : `${n} פערים פתוחים`} (${d})`,
  },
  en: {
    title: "Knowledge Gap Report",
    period: (a: string, b: string) => `Period: ${a} - ${b}`,
    asked: "questions asked",
    answered: "fully answered",
    partial: "partly answered",
    noInfo: "no information",
    gapsHeading: (n: number) => (n === 1 ? "1 open gap" : `${n} open gaps, most asked first`),
    none: "No open gaps. Every question was answered from the knowledge base.",
    times: (n: number) => (n === 1 ? "Asked once" : `Asked ${n} times`),
    isNew: "New",
    howAsked: "How people asked:",
    reasons: { no_info: "No info", partial: "Partial answer", not_helpful: "Didn't help" },
    closedHeading: (n: number) => (n === 1 ? "1 gap closed since the last report" : `${n} gaps closed since the last report`),
    footer: "To close a gap, upload a document that answers it. Next time someone asks, there will be an answer.",
    subject: (n: number, d: string) => `Knowledge gap report - ${n === 1 ? "1 open gap" : `${n} open gaps`} (${d})`,
  },
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const fmtDate = (iso: string, lang: Lang) =>
  new Date(iso).toLocaleDateString(lang === "he" ? "he-IL" : "en-GB", { timeZone: "Asia/Jerusalem" });

export function reportSubject(r: ReportData, lang: Lang) {
  return T[lang].subject(r.gaps.length, fmtDate(r.createdAt, lang));
}

/** A complete, self-contained HTML document. Inline styles and tables only, so it renders inside email clients. */
export function buildReportHtml(r: ReportData, lang: Lang): string {
  const t = T[lang];
  const dir = lang === "he" ? "rtl" : "ltr";
  const align = lang === "he" ? "right" : "left";
  const font = "font-family:Arial,Helvetica,sans-serif;";
  const stat = (n: number, label: string, color: string) =>
    `<td style="padding:12px 8px;text-align:center;background:#f4f7fa;border-radius:10px;${font}">
      <div style="font-size:26px;font-weight:bold;color:${color};">${n}</div>
      <div style="font-size:13px;color:#5b6b79;">${esc(label)}</div></td>`;

  const gapRows = r.gaps
    .map((g) => {
      const title = lang === "he" ? g.titleHe : g.titleEn;
      const examples = g.examples
        .slice(0, 3)
        .map(
          (e) => `<li style="margin:2px 0;color:#13222f;">${esc(e.question)}
            <span style="font-size:11px;color:#5b6b79;">(${esc(t.reasons[e.reason])})</span></li>`,
        )
        .join("");
      return `<tr><td style="padding:14px 16px;border:1px solid #dde4ea;border-radius:12px;${font}text-align:${align};">
        <div style="font-size:16px;font-weight:bold;color:#13222f;">${esc(title)}
          ${g.isNew ? `<span style="font-size:11px;background:#0a6fb8;color:#ffffff;padding:2px 8px;border-radius:999px;">${t.isNew}</span>` : ""}</div>
        <div style="font-size:13px;color:#7a5300;margin:4px 0;font-weight:bold;">${t.times(g.count)}</div>
        <div style="font-size:13px;color:#5b6b79;">${t.howAsked}</div>
        <ul style="margin:4px 0 0;padding-${lang === "he" ? "right" : "left"}:18px;font-size:14px;">${examples}</ul>
      </td></tr><tr><td style="height:10px;"></td></tr>`;
    })
    .join("");

  const closed = r.closed ?? [];
  const closedRows = closed.length
    ? `<tr><td style="${font}text-align:${align};font-size:17px;font-weight:bold;color:#11806a;padding:10px 0;">✓ ${esc(t.closedHeading(closed.length))}</td></tr>
       <tr><td style="${font}text-align:${align};padding-bottom:14px;"><ul style="margin:0;padding-${lang === "he" ? "right" : "left"}:18px;font-size:14px;color:#13222f;">
       ${closed.map((c) => `<li style="margin:2px 0;">${esc(lang === "he" ? c.titleHe : c.titleEn)} <span style="font-size:12px;color:#5b6b79;">(${esc(fmtDate(c.closedAt, lang))})</span></li>`).join("")}
       </ul></td></tr>`
    : "";

  return `<!doctype html>
<html lang="${lang}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(t.title)}</title></head>
<body style="margin:0;padding:0;background:#ffffff;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="${dir}" style="background:#ffffff;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;" dir="${dir}">
  <tr><td style="${font}text-align:${align};">
    <div style="font-size:24px;font-weight:bold;color:#0a6fb8;">💧 ${esc(t.title)}</div>
    <div style="font-size:13px;color:#5b6b79;margin:4px 0 18px;">${esc(t.period(fmtDate(r.periodStart, lang), fmtDate(r.createdAt, lang)))}</div>
  </td></tr>
  <tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="6"><tr>
    ${stat(r.stats.asked, t.asked, "#13222f")}${stat(r.stats.answered, t.answered, "#11806a")}${stat(r.stats.partial, t.partial, "#7a5300")}${stat(r.stats.noInfo, t.noInfo, "#a12a1b")}
  </tr></table></td></tr>
  <tr><td style="${font}text-align:${align};font-size:17px;font-weight:bold;color:#13222f;padding:20px 0 10px;">
    ${r.gaps.length ? esc(t.gapsHeading(r.gaps.length)) : esc(t.none)}</td></tr>
  <tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${gapRows}</table></td></tr>
  ${closedRows}
  <tr><td style="${font}text-align:${align};font-size:13px;color:#5b6b79;padding-top:10px;border-top:1px solid #dde4ea;">${esc(t.footer)}</td></tr>
</table></td></tr></table></body></html>`;
}
