import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ask, AskError, sendFeedback, type AskResult } from "../api";
import { useLang } from "../i18n";
import TypeBadge from "../TypeBadge";
import CopyButton from "../CopyButton";

interface Turn {
  question: string;
  result?: AskResult;
  error?: string;
  feedback?: "sending" | "sent";
}

export default function AskPage() {
  const { t, lang } = useLang();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState<string>();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<number>(-1);
  const endRef = useRef<HTMLDivElement>(null);

  // Scroll only this page's own window: scrollIntoView can also move a frame's host page.
  useEffect(() => {
    if (turns.length === 0) return;
    const el = endRef.current;
    if (!el) return;
    const top = el.getBoundingClientRect().bottom + window.scrollY - window.innerHeight + 24;
    if (top > window.scrollY) window.scrollTo({ top, behavior: "smooth" });
  }, [turns.length, busy]);

  const errorText = (code: string) =>
    code.startsWith("demo:") ? `${t.errGeneric} (${code.slice(5)})` :
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

  async function notHelpful(index: number) {
    const r = turns[index]?.result;
    if (!r) return;
    setTurns((prev) => prev.map((tr, i) => (i === index ? { ...tr, feedback: "sending" } : tr)));
    try {
      await sendFeedback(r.conversationId, r.turn);
      setTurns((prev) => prev.map((tr, i) => (i === index ? { ...tr, feedback: "sent" } : tr)));
    } catch {
      setTurns((prev) => prev.map((tr, i) => (i === index ? { ...tr, feedback: undefined } : tr)));
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
            <div className="question-row">
              <div className="bubble question" dir="auto">{turn.question}</div>
              <CopyButton text={turn.question} />
            </div>
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
            {turn.result?.status === "answered" && (
              <div className="answer-footer">
                {turn.result.fromMemory ? <span className="memory-tag">⚡ {t.fromMemory}</span> : null}
                {turn.result.docsRead && !turn.result.fromMemory && <span className="muted small">{t.docsSent(turn.result.docsRead.sent, turn.result.docsRead.total)}</span>}
                <CopyButton text={turn.result.segments.map((s) => s.text).join("").trim()} />
                {turn.feedback === "sent" ? (
                  <span className="muted small">{t.notHelpfulThanks}</span>
                ) : (
                  <button type="button" className="link-btn" onClick={() => notHelpful(i)} disabled={!!turn.feedback}>
                    {t.notHelpful}
                  </button>
                )}
              </div>
            )}
            {turn.error && (
              <div className="error-row">
                <div className="bubble error-bubble">{errorText(turn.error)}</div>
                <CopyButton text={errorText(turn.error)} />
              </div>
            )}
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
