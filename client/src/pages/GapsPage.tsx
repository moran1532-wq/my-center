import { useEffect, useState } from "react";
import { listGaps, setGapStatus, type Gap } from "../api";
import { useLang } from "../i18n";

export default function GapsPage() {
  const { t, lang } = useLang();
  const [gaps, setGaps] = useState<Gap[] | null>(null);
  const [error, setError] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const load = () => listGaps().then((g) => (setGaps(g), setError(false))).catch(() => setError(true));
  useEffect(() => {
    load();
    // checks run in the background after each answer - keep the list fresh
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, []);

  async function toggle(id: string, dismiss: boolean) {
    try {
      await setGapStatus(id, dismiss ? "dismiss" : "restore");
      setDismissed((prev) => {
        const next = new Set(prev);
        if (dismiss) next.add(id);
        else next.delete(id);
        return next;
      });
    } catch {
      setError(true);
    }
  }

  const date = (iso: string) => new Date(iso).toLocaleDateString(lang === "he" ? "he-IL" : "en-GB");

  return (
    <section className="gaps">
      <h1>{t.gapsTitle}</h1>
      <p className="muted">{t.gapsIntro}</p>
      {error && <p className="state error">{t.gapsLoadError}</p>}
      {!error && gaps === null && <p className="state">{t.loading}</p>}
      {gaps?.length === 0 && <p className="state">{t.gapsEmpty}</p>}
      <ul className="gap-list">
        {gaps?.map((g) =>
          dismissed.has(g.id) ? (
            <li key={g.id} className="gap gap-dismissed">
              <span>{t.markedNotAGap}</span>
              <button className="ghost" onClick={() => toggle(g.id, false)}>{t.undo}</button>
            </li>
          ) : (
            <li key={g.id} className="gap">
              <div className="gap-head">
                <h2 dir="auto">{lang === "he" ? g.titleHe : g.titleEn}</h2>
                <span className="gap-count">{t.askedTimes(g.count)}</span>
              </div>
              <p className="muted small">{t.lastAsked}: {date(g.lastAskedAt)}</p>
              <p className="small">{t.examplesLabel}</p>
              <ul className="gap-examples">
                {g.examples.slice(0, 3).map((e, i) => (
                  <li key={i}>
                    <span dir="auto" className="gap-q">{e.question}</span>
                    <span className={`reason reason-${e.reason}`}>{t[`reason_${e.reason}`]}</span>
                  </li>
                ))}
              </ul>
              <div className="gap-actions">
                <button className="ghost" onClick={() => toggle(g.id, true)}>{t.notAGap}</button>
              </div>
            </li>
          ),
        )}
      </ul>
    </section>
  );
}
