import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listKnowledge, type KnowledgeSummary, type KnowledgeType } from "../api";
import { useLang } from "../i18n";
import TypeBadge from "../TypeBadge";

const FILTERS: (KnowledgeType | undefined)[] = [undefined, "procedure", "customer_answer", "document"];

export default function KnowledgeList() {
  const { t, lang } = useLang();
  const [type, setType] = useState<KnowledgeType | undefined>();
  const [q, setQ] = useState("");
  const [items, setItems] = useState<KnowledgeSummary[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    const handle = setTimeout(() => {
      listKnowledge(type, q.trim() || undefined)
        .then((r) => alive && (setItems(r), setError(false)))
        .catch(() => alive && setError(true));
    }, 200);
    return () => {
      alive = false;
      clearTimeout(handle);
    };
  }, [type, q]);

  const label = (f: KnowledgeType | undefined) =>
    f === undefined ? t.all : f === "procedure" ? t.procedures : f === "document" ? t.documents : t.customer_answers;

  return (
    <section>
      <div className="toolbar">
        <div className="chips" role="tablist">
          {FILTERS.map((f) => (
            <button
              key={f ?? "all"}
              role="tab"
              aria-selected={type === f}
              className={type === f ? "chip active" : "chip"}
              onClick={() => setType(f)}
            >
              {label(f)}
            </button>
          ))}
        </div>
        <input
          className="search"
          type="search"
          placeholder={t.search}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label={t.search}
        />
      </div>

      {error && <p className="state error">{t.error}</p>}
      {!error && items === null && <p className="state">{t.loading}</p>}
      {!error && items?.length === 0 && <p className="state">{t.noResults}</p>}
      {!error && items && items.length > 0 && <p className="count">{t.count(items.length)}</p>}

      <ul className="cards">
        {items?.map((i) => (
          <li key={i.id}>
            <Link to={`/item/${i.id}`} className="card">
              <div className="card-head">
                <TypeBadge type={i.type} />
                {i.isSample && <span className="sample">{t.sample}</span>}
              </div>
              <h3 dir="auto">{i.title}</h3>
              <p className="excerpt" dir="auto">{i.excerpt}…</p>
              <div className="meta">
                <span>{t.topic}: {i.topic}</span>
                <span>{t.updated}: {new Date(i.updatedAt).toLocaleDateString(lang === "he" ? "he-IL" : "en-GB")}</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
