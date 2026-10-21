import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getKnowledge, type KnowledgeItem } from "../api";
import { useLang } from "../i18n";
import TypeBadge from "../TypeBadge";

export default function KnowledgeView() {
  const { id = "" } = useParams();
  const { t, lang } = useLang();
  const [item, setItem] = useState<KnowledgeItem | null | undefined>();
  const [error, setError] = useState(false);

  useEffect(() => {
    getKnowledge(id).then(setItem).catch(() => setError(true));
  }, [id]);

  return (
    <article className="item">
      <Link to="/" className="back">{lang === "he" ? "→" : "←"} {t.back}</Link>
      {error && <p className="state error">{t.error}</p>}
      {!error && item === undefined && <p className="state">{t.loading}</p>}
      {item === null && <p className="state">{t.notFound}</p>}
      {item && (
        <>
          <div className="card-head">
            <TypeBadge type={item.type} />
            {item.isSample && <span className="sample">{t.sample}</span>}
          </div>
          <h1 dir="auto">{item.title}</h1>
          <dl className="facts">
            <div><dt>{t.topic}</dt><dd>{item.topic}</dd></div>
            <div><dt>{t.updated}</dt><dd>{new Date(item.updatedAt).toLocaleDateString(lang === "he" ? "he-IL" : "en-GB")}</dd></div>
            <div><dt>{t.owner}</dt><dd>{item.owner}</dd></div>
          </dl>
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
