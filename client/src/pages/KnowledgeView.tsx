import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { archiveDoc, getKnowledge, restoreDoc, type KnowledgeItem } from "../api";
import { useIsOwner } from "../role";
import { useLang } from "../i18n";
import TypeBadge from "../TypeBadge";

export default function KnowledgeView() {
  const { id = "" } = useParams();
  const { t, lang } = useLang();
  const [item, setItem] = useState<KnowledgeItem | null | undefined>();
  const [error, setError] = useState(false);
  const isOwner = useIsOwner();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  async function remove() {
    if (!item) return;
    setBusy(true);
    try {
      const r = await archiveDoc(item.id);
      navigate("/browse", { state: { notice: t.removedOk(r.reopened.length) } });
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    if (!item) return;
    setBusy(true);
    try {
      await restoreDoc(item.id);
      setItem({ ...item, archived: false });
      setNotice(t.restoredOk);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    setItem(undefined);
    getKnowledge(id, lang).then(setItem).catch(() => setError(true));
  }, [id, lang]);

  return (
    <article className="item">
      <Link to="/browse" className="back">{lang === "he" ? "→" : "←"} {t.back}</Link>
      {error && <p className="state error">{t.error}</p>}
      {!error && item === undefined && <p className="state">{t.loading}</p>}
      {item === null && <p className="state">{t.notFound}</p>}
      {item && (
        <>
          {item.archived && (
            <div className="archived-banner" role="status">
              <span>{t.archivedBanner}</span>
              {isOwner && <button className="primary" onClick={restore} disabled={busy}>{t.restoreDoc}</button>}
            </div>
          )}
          {notice && <p className="verdict ok" role="status">✓ {notice}</p>}
          <div className="card-head">
            <TypeBadge type={item.type} />
            {item.isSample && <span className="sample">{t.sample}</span>}
          </div>
          <h1 dir="auto">{item.title}</h1>
          <dl className="facts">
            <div><dt>{t.topic}</dt><dd>{item.topic}</dd></div>
            <div><dt>{t.updated}</dt><dd>{new Date(item.updatedAt).toLocaleDateString(lang === "he" ? "he-IL" : "en-GB")}</dd></div>
            <div><dt>{t.owner}</dt><dd>{item.owner}</dd></div>
            {item.sourceUrl && (
              <div><dt>{t.sourceLink}</dt><dd><a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" dir="ltr">{new URL(item.sourceUrl).hostname}</a></dd></div>
            )}
          </dl>
          {isOwner && !item.archived && (
            <div className="doc-actions">
              {confirming ? (
                <div className="confirm-box" role="alertdialog" aria-label={t.removeDoc}>
                  <span dir="auto">{t.confirmRemoveDoc(item.title)}</span>
                  <span className="owner-actions">
                    <button className="danger" onClick={remove} disabled={busy}>{t.yesRemove}</button>
                    <button className="ghost" onClick={() => setConfirming(false)} disabled={busy}>{t.cancel}</button>
                  </span>
                </div>
              ) : (
                <button className="ghost" onClick={() => setConfirming(true)}>{t.removeDoc}</button>
              )}
            </div>
          )}
          <div className="body" dir="auto">
            {item.body.split(/\n\s*\n/).map((p, n) => (
              <p key={n}>{p}</p>
            ))}
          </div>
        </>
      )}
    </article>
  );
}
