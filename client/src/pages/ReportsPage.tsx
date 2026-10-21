import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  addRecipient, generateReport, listRecipients, listReports, removeRecipient, reportHtml,
  type Lang, type Recipient, type ReportSummary,
} from "../api";
import { useLang } from "../i18n";
import { useIsOwner } from "../role";

const DEMO = import.meta.env.VITE_DEMO === "1";

export default function ReportsPage() {
  const { t, lang } = useLang();
  const [reports, setReports] = useState<ReportSummary[] | null>(null);
  const [nextDue, setNextDue] = useState<string | null>(null);
  const [owners, setOwners] = useState<Recipient[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<ReportSummary | null>(null);
  const isOwner = useIsOwner();

  const load = async () => {
    try {
      const r = await listReports();
      setReports(r.reports);
      setNextDue(r.nextDue);
      setOwners(isOwner ? await listRecipients() : []);
    } catch {
      setError(t.saveError);
    }
  };
  useEffect(() => {
    load();
  }, [isOwner]);

  async function makeNow() {
    setBusy(true);
    setError("");
    try {
      const r = await generateReport();
      await load();
      setOpen(r);
    } catch {
      setError(t.saveError);
    } finally {
      setBusy(false);
    }
  }

  const when = (iso: string) =>
    new Date(iso).toLocaleString(lang === "he" ? "he-IL" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jerusalem" });
  const deliveryText = (r: ReportSummary) =>
    r.delivery.note === "sent" ? t.delivery_sent(r.delivery.emailed.length) : t[`delivery_${r.delivery.note}`];

  return (
    <section className="reports">
      <div className="reports-head">
        <div>
          <h1>{t.reportsTitle}</h1>
          <p className="muted">{t.reportsIntro}</p>
          {nextDue && <p className="small">{t.nextReport}: <strong>{when(nextDue)}</strong></p>}
        </div>
        {isOwner && <button className="primary" onClick={makeNow} disabled={busy}>{busy ? t.generating : t.generateNow}</button>}
      </div>
      {error && <p className="state error">{error}</p>}

      {open && <ReportViewer report={open} owners={owners} onClose={() => setOpen(null)} />}

      {reports?.length === 0 && <p className="state">{t.noReports}</p>}
      <ul className="report-list">
        {reports?.map((r) => (
          <li key={r.id} className={`report-row ${open?.id === r.id ? "selected" : ""}`}>
            <div className="report-main">
              <strong>{when(r.createdAt)}</strong>
              <span className="tag">{r.trigger === "schedule" ? t.triggerSchedule : t.triggerManual}</span>
            </div>
            <div className="muted small">{t.statsLine(r.stats.asked, r.stats.answered)} · {t.gapsLine(r.gapCount, r.newCount)}</div>
            <div className={`small delivery delivery-${r.delivery.note}`}>{deliveryText(r)}</div>
            <button className="ghost" onClick={() => setOpen(r)}>{t.view}</button>
          </li>
        ))}
      </ul>

      {isOwner && <Owners owners={owners} onChange={load} />}
    </section>
  );
}

function ReportViewer({ report, owners, onClose }: { report: ReportSummary; owners: Recipient[]; onClose: () => void }) {
  const { t, lang } = useLang();
  const [viewLang, setViewLang] = useState<Lang>(lang);
  const [html, setHtml] = useState("");

  useEffect(() => {
    reportHtml(report.id, viewLang).then(setHtml).catch(() => setHtml(""));
  }, [report.id, viewLang]);

  const to = owners.filter((o) => o.lang === viewLang).map((o) => `${o.name} <${o.email}>`).join(", ");

  return (
    <div className="viewer">
      <div className="viewer-bar">
        <span className="small">{t.reportLang}</span>
        {(["he", "en"] as const).map((l) => (
          <button key={l} className={viewLang === l ? "chip active" : "chip"} onClick={() => setViewLang(l)}>
            {l === "he" ? t.hebrew : t.english}
          </button>
        ))}
        <button className="ghost close" onClick={onClose}>{t.closeReport}</button>
      </div>
      <div className="email-meta">
        <p className="small"><strong>{t.emailPreview}</strong></p>
        <dl>
          <div><dt>{t.emailTo}</dt><dd dir="auto">{to || "-"}</dd></div>
          <div><dt>{t.emailSubject}</dt><dd dir="auto">{report.subjects[viewLang]}</dd></div>
          <div><dt>{t.emailAttachment}</dt><dd dir="ltr">knowledge-gaps-{report.createdAt.slice(0, 10)}.html</dd></div>
        </dl>
        {DEMO && <p className="muted small">{t.previewNoMail}</p>}
      </div>
      <ReportBody html={html} />
    </div>
  );
}

function Owners({ owners, onChange }: { owners: Recipient[]; onChange: () => void }) {
  const { t } = useLang();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [ownerLang, setOwnerLang] = useState<Lang>("he");
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setError("");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) return setError(t.invalidEmail);
    setSaving(true);
    try {
      await addRecipient({ name: name.trim(), email: email.trim(), lang: ownerLang });
      setName("");
      setEmail("");
      onChange();
    } catch {
      setError(t.saveError);
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    try {
      await removeRecipient(id);
      setConfirming(null);
      onChange();
    } catch {
      setError(t.saveError);
    }
  }

  return (
    <section className="owners">
      <h2>{t.ownersTitle}</h2>
      <p className="muted small">{t.ownersIntro}</p>
      {owners.length === 0 && <p className="state">{t.ownersEmpty}</p>}
      <ul className="owner-list">
        {owners.map((o) => (
          <li key={o.id}>
            {confirming === o.id ? (
              <>
                <span>{t.confirmRemove(o.name)}</span>
                <span className="owner-actions">
                  <button className="danger" onClick={() => remove(o.id)}>{t.yes}</button>
                  <button className="ghost" onClick={() => setConfirming(null)}>{t.no}</button>
                </span>
              </>
            ) : (
              <>
                <span><strong dir="auto">{o.name}</strong> <span className="muted" dir="ltr">{o.email}</span> <span className="tag">{o.lang === "he" ? t.hebrew : t.english}</span></span>
                <button className="ghost" onClick={() => setConfirming(o.id)}>{t.remove}</button>
              </>
            )}
          </li>
        ))}
      </ul>
      <form className="owner-form" onSubmit={add} aria-busy={saving}>
        <input id="owner-name" placeholder={t.name} aria-label={t.name} value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} />
        <input id="owner-email" type="email" dir="ltr" placeholder={t.email} aria-label={t.email} value={email} onChange={(e) => setEmail(e.target.value)} required />
        <select id="owner-lang" aria-label={t.language} value={ownerLang} onChange={(e) => setOwnerLang(e.target.value as Lang)}>
          <option value="he">{t.hebrew}</option>
          <option value="en">{t.english}</option>
        </select>
        <button className="primary" type="submit" disabled={saving}>{t.add}</button>
      </form>
      {error && <p className="state error">{error}</p>}
    </section>
  );
}

/**
 * Shows the report in an isolated shadow root, so the page's styles and the report's don't mix.
 * The HTML comes from our own report builder, which escapes every question and title.
 */
function ReportBody({ html }: { html: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const root = el.shadowRoot ?? el.attachShadow({ mode: "open" });
    const doc = new DOMParser().parseFromString(html, "text/html");
    doc.querySelectorAll("script").forEach((n) => n.remove());
    root.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.setAttribute("dir", doc.documentElement.getAttribute("dir") ?? "auto");
    wrap.style.background = "#ffffff";
    wrap.append(...Array.from(doc.body.childNodes));
    root.append(wrap);
  }, [html]);
  return <div ref={host} className="report-frame" />;
}
