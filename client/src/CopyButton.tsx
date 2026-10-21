import { useState } from "react";
import { useLang } from "./i18n";

/** Copies text. Falls back to a hidden text area where the clipboard API is refused. */
export default function CopyButton({ text }: { text: string }) {
  const { t } = useLang();
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.append(area);
      area.select();
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      area.remove();
    }
    setState(ok ? "copied" : "failed");
    setTimeout(() => setState("idle"), 2000);
  }

  return (
    <button type="button" className="link-btn copy-btn" onClick={copy} aria-live="polite">
      {state === "copied" ? `✓ ${t.copied}` : state === "failed" ? t.copyFailed : t.copy}
    </button>
  );
}
