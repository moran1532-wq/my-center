import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { AskError, commitUpload, previewUpload, type KnowledgeType, type UploadPreview } from "./api";
import { useLang } from "./i18n";

type Source = "file" | "link" | "paste";
type Step = "pick" | "reading" | "review" | "saving" | "done";

export default function UploadDialog({ gap, onClose }: {
  gap: { id: string; title: string } | null;
  onClose: (changed: boolean) => void;
}) {
  const { t, lang } = useLang();
  const [source, setSource] = useState<Source>("file");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [step, setStep] = useState<Step>("pick");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<UploadPreview | null>(null);
  const [fields, setFields] = useState({ titleHe: "", titleEn: "", topicHe: "", topicEn: "", type: "document" as KnowledgeType });
  const [closeIds, setCloseIds] = useState<Set<string>>(new Set());
  const [closeTargetAnyway, setCloseTargetAnyway] = useState(false);
  const [result, setResult] = useState<{ itemId: string; closed: { id: string; titleHe: string; titleEn: string }[] } | null>(null);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialog.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && step !== "reading" && step !== "saving" && onClose(step === "done");
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  const errorText = (e: unknown) => {
    const code = e instanceof AskError ? e.code : "";
    return (t as Record<string, unknown>)[`up_${code}`] as string ?? (code === "busy" ? t.errBusy : t.up_generic);
  };

  async function read(e: FormEvent) {
    e.preventDefault();
    setError("");
    setStep("reading");
    try {
      const p = await previewUpload({
        gapId: gap?.id ?? null,
        ...(source === "file" ? { file: file ?? undefined } : source === "link" ? { url } : { text }),
      });
      setPreview(p);
      const a = p.analysis;
      setFields({ titleHe: a.titleHe, titleEn: a.titleEn, topicHe: a.topicHe, topicEn: a.topicEn, type: a.type });
      setCloseIds(new Set(p.suggestedGaps.map((g) => g.id)));
      setStep("review");
    } catch (err) {
      setError(errorText(err));
      setStep("pick");
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!preview) return;
    setError("");
    setStep("saving");
    const ids = new Set(closeIds);
    if (gap && closeTargetAnyway) ids.add(gap.id);
    try {
      const r = await commitUpload({ draftId: preview.draftId, ...fields, closeGapIds: [...ids], closeTargetAnyway: !!gap && closeTargetAnyway });
      setResult({ itemId: r.itemId, closed: r.closed });
      setStep("done");
    } catch (err) {
      setError(errorText(err));
      setStep(err instanceof AskError && err.code === "draft_expired" ? "pick" : "review");
    }
  }

  const target = preview?.analysis.targetGap;
  const others = preview?.suggestedGaps.filter((g) => !g.isTarget) ?? [];
  const canRead = source === "file" ? !!file : source === "link" ? url.trim().length > 0 : text.trim().length > 0;
  const toggle = (id: string) => setCloseIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div className="overlay" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && step === "pick" && onClose(false)}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="upload-title" tabIndex={-1} ref={dialog}>
        <h2 id="upload-title">{gap ? t.uploadTitleGap : t.uploadTitleGeneral}</h2>
        {gap && <p className="dialog-gap" dir="auto">{gap.title}</p>}

        {(step === "pick" || step === "reading") && (
          <form onSubmit={read} className="dialog-body">
            <div className="chips" role="tablist">
              {(["file", "link", "paste"] as const).map((s) => (
                <button type="button" key={s} role="tab" aria-selected={source === s} className={source === s ? "chip active" : "chip"} onClick={() => setSource(s)}>
                  {s === "file" ? t.srcFile : s === "link" ? t.srcLink : t.srcPaste}
                </button>
              ))}
            </div>
            {source === "file" && (
              <label className="file-pick">
                <input id="upload-file" type="file" accept=".pdf,.docx,.txt,.md,.html,.htm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                <span className="muted small">{t.fileHint}</span>
              </label>
            )}
            {source === "link" && (
              <label className="field">
                <input id="upload-url" type="url" dir="ltr" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
                <span className="muted small">{t.linkHint}</span>
              </label>
            )}
            {source === "paste" && (
              <textarea id="upload-text" rows={8} dir="auto" placeholder={t.pasteHint} value={text} onChange={(e) => setText(e.target.value)} />
            )}
            {error && <p className="state error">{error}</p>}
            <div className="dialog-actions">
              <button type="button" className="ghost" onClick={() => onClose(false)} disabled={step === "reading"}>{t.cancel}</button>
              <button type="submit" className="primary" disabled={!canRead || step === "reading"}>{step === "reading" ? t.reading : t.read}</button>
            </div>
          </form>
        )}

        {(step === "review" || step === "saving") && preview && (
          <form onSubmit={save} className="dialog-body">
            {target && (
              <div className={target.answers ? "verdict ok" : "verdict warn"}>
                <strong>{target.answers ? `✓ ${t.answersGap}` : `! ${t.notAnswersGap}`}</strong>
                <span dir="auto">{lang === "he" ? target.explanationHe : target.explanationEn}</span>
                {!target.answers && (
                  <label className="check">
                    <input id="close-anyway" type="checkbox" checked={closeTargetAnyway} onChange={(e) => setCloseTargetAnyway(e.target.checked)} />
                    {t.closeAnyway}
                  </label>
                )}
              </div>
            )}
            {others.length > 0 && (
              <div className="verdict ok">
                <strong>{t.alsoCloses}</strong>
                {others.map((g) => (
                  <label key={g.id} className="check">
                    <input type="checkbox" checked={closeIds.has(g.id)} onChange={() => toggle(g.id)} />
                    <span dir="auto">{lang === "he" ? g.titleHe : g.titleEn}</span>
                  </label>
                ))}
              </div>
            )}
            <p className="small">{t.reviewHint}</p>
            <div className="field-grid">
              <label>{t.titleHe}<input id="f-title-he" dir="rtl" value={fields.titleHe} maxLength={200} onChange={(e) => setFields({ ...fields, titleHe: e.target.value })} /></label>
              <label>{t.titleEn}<input id="f-title-en" dir="ltr" value={fields.titleEn} maxLength={200} onChange={(e) => setFields({ ...fields, titleEn: e.target.value })} /></label>
              <label>{t.topicHe}<input id="f-topic-he" dir="rtl" value={fields.topicHe} maxLength={60} onChange={(e) => setFields({ ...fields, topicHe: e.target.value })} /></label>
              <label>{t.topicEn}<input id="f-topic-en" dir="ltr" value={fields.topicEn} maxLength={60} onChange={(e) => setFields({ ...fields, topicEn: e.target.value })} /></label>
              <label>{t.typeLabel}
                <select id="f-type" value={fields.type} onChange={(e) => setFields({ ...fields, type: e.target.value as KnowledgeType })}>
                  <option value="procedure">{t.procedure}</option>
                  <option value="customer_answer">{t.customer_answer}</option>
                  <option value="document">{t.document}</option>
                </select>
              </label>
            </div>
            <details>
              <summary className="small">{t.excerpt}</summary>
              <pre className="excerpt-box" dir="auto">{preview.excerpt}{preview.chars > preview.excerpt.length ? "…" : ""}</pre>
              {preview.truncated && <p className="muted small">{t.truncatedNote}</p>}
            </details>
            {error && <p className="state error">{error}</p>}
            <div className="dialog-actions">
              <button type="button" className="ghost" onClick={() => onClose(false)} disabled={step === "saving"}>{t.cancel}</button>
              <button type="submit" className="primary" disabled={step === "saving" || (!fields.titleHe.trim() && !fields.titleEn.trim())}>
                {step === "saving" ? t.saving : t.save}
              </button>
            </div>
          </form>
        )}

        {step === "done" && result && (
          <div className="dialog-body">
            <div className="verdict ok">
              <strong>✓ {t.savedOk(result.closed.length)}</strong>
              {result.closed.length > 0 && (
                <ul className="closed-names">
                  {result.closed.map((g) => <li key={g.id} dir="auto">{lang === "he" ? g.titleHe : g.titleEn}</li>)}
                </ul>
              )}
            </div>
            <div className="dialog-actions">
              <Link className="ghost as-button" to={`/item/${result.itemId}`} onClick={() => onClose(true)}>{t.openSaved}</Link>
              <button type="button" className="primary" onClick={() => onClose(true)}>{t.done}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
