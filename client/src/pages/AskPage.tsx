import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ask, AskError, type AskResult } from "../api";
import { useLang } from "../i18n";
import TypeBadge from "../TypeBadge";

interface Turn {
  question: string;
  result?: AskResult;
  error?: string;
}

export default function AskPage() {
  const { t, lang } = useLang();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState<string>();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<number>(-1);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), [turns.length, busy]);

  const errorText = (code: string) =>
    ({ no_key: t.errNoKey, bad_key: t.errBadKey, busy: t.errBusy, conversation_expired: t.errExpired, conversation_too_long: t.errTooLong } as Record<string, string>)[code] ??
    t.errGeneric;

  async function submit(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setDraft("");
    setBusy(true);
    const index = turns.length;
    setTurns((prev) => [...prev, { question: q }]);
    try {
      const result = await ask(q, lang, conversationId);
      setConversationId(result.conversationId);
      setTurns((prev) => prev.map((tr, i) => (i === index ? { ...tr, result } : tr)));
      setSelected(index);
    } catch (err) {
      const code = err instanceof AskError ? err.code : "unknown";
      if (code === "conversation_expired") setConversationId(undefined);
      setTurns((prev) => prev.map((tr, i) => (i === index ? { ...tr, error: code } : tr)));
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setTurns([]);
    setConversationId(undefined);
    setSelected(-1);
    setDraft("");
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(draft);
  };

  const shown = turns[selected]?.result;

  return (
    <div className="ask-layout">
      <section className="thread" aria-live="polite">
        {turns.length === 0 && (
          <div className="ask-empty">
            <p className="ask-intro">{t.askIntro}</p>
            <p className="muted">{t.tryAsking}</p>
            <div className="examples">
              {t.examples.map((ex) => (
                <button key={ex} className="example" onClick={() => submit(ex)} disabled={busy}>
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((turn, i) => (
          <div key={i} className="turn">
            <div className="bubble question" dir="auto">{turn.question}</div>
            {turn.result && (
              <button
                type="button"
                className={`bubble answer ${i === selected ? "selected" : ""}`}
                onClick={() => setSelected(i)}
              >
                {turn.result.status === "declined" ? (
                  <span className="muted">{t.declined}</span>
                ) : (
                  <span dir="auto" className="answer-text">
                    {turn.result.segments.map((s, n) => (
                      <span key={n}>
                        {s.text}
                        {s.sourceRefs.map((r) => (
                          <sup key={r} className="ref" title={t.sourceN(r)}>{r}</sup>
                        ))}
                      </span>
                    ))}
                  </span>
                )}
              </button>
            )}
            {turn.error && <div className="bubble error-bubble">{errorText(turn.error)}</div>}
          </div>
        ))}

        {busy && <div className="bubble answer pending">{t.thinking}</div>}
        <div ref={endRef} />

        <form className="ask-form" onSubmit={onSubmit}>
          <textarea
            id="question"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(draft);
              }
            }}
            placeholder={turns.length ? t.followPlaceholder : t.askPlaceholder}
            rows={2}
            maxLength={2000}
            dir="auto"
            aria-label={t.askPlaceholder}
          />
          <div className="ask-actions">
            {turns.length > 0 && (
              <button type="button" className="ghost" onClick={reset} disabled={busy}>
                {t.newQuestion}
              </button>
            )}
            <button type="submit" className="primary" disabled={busy || !draft.trim()}>
              {t.send}
            </button>
          </div>
        </form>
      </section>

      <aside className="sources-panel">
        <h2>{t.sources}</h2>
        <p className="muted small">{t.sourcesHint}</p>
        {shown && shown.sources.length === 0 && <p className="muted">{t.noSources}</p>}
        {shown?.sources.map((s) => (
          <div key={s.id} className="source">
            <div className="card-head">
              <span className="source-num">{s.number}</span>
              <TypeBadge type={s.type} />
            </div>
            <h3 dir="auto">{s.title}</h3>
            {s.passages.map((p, n) => (
              <blockquote key={n} dir="auto">{p}</blockquote>
            ))}
            <Link to={`/item/${s.id}`} className="open-doc">{t.openDoc}</Link>
          </div>
        ))}
      </aside>
    </div>
  );
}
