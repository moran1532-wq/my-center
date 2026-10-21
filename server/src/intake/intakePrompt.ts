import type { GapRef } from "./types.js";

const gapLine = (g: GapRef) =>
  `- id: ${g.id} | ${g.titleHe} | ${g.titleEn}\n  asked as: ${g.questions.slice(0, 3).map((q) => `"${q}"`).join("; ")}`;

export function buildIntakePrompt(text: string, target: GapRef | null, openGaps: GapRef[]): string {
  const others = openGaps.filter((g) => g.id !== target?.id);
  return `A knowledge owner at a water-technology company is adding a document to the team's knowledge base. Read it and describe it.

<document>
${text}
</document>

Return:
- titleHe / titleEn: a short, clear title for the document in Hebrew and in English.
- type: "procedure" (steps people follow), "customer_answer" (a ready answer to give customers) or "document" (reference: specs, guides, policies).
- topicHe / topicEn: one or two words for the topic (for example "Alerts" / "התראות").
- sourceLang: "he" if the document is mostly Hebrew, otherwise "en".
${target ? `
The owner is uploading it to fill this knowledge gap:
${gapLine(target)}
- targetGap.answers: true only if the document actually contains the information those questions ask for.
- targetGap.explanationHe / explanationEn: one sentence. If it answers, say where. If not, say what is missing.` : `
- targetGap: null.`}

Other open knowledge gaps:
${others.length ? others.map(gapLine).join("\n") : "(none)"}
- alsoAnswersGapIds: ids of the gaps above that this document clearly answers. Empty if none. Only include a gap if the document contains the specific information asked for.`;
}

export function buildTranslatePrompt(text: string, to: "he" | "en"): string {
  return `Translate this company document into ${to === "he" ? "Hebrew" : "English"}. Keep the meaning, numbers, units, product names and structure (numbered steps, line breaks) exactly. Use the professional terms a water-technology team would use. Reply with the translation only.

<document>
${text}
</document>`;
}
