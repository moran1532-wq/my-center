import type { Gap, GapCandidate } from "./types.js";

export function buildAnalyzerPrompt(c: GapCandidate, existing: Pick<Gap, "id" | "titleHe" | "titleEn">[]): string {
  const list = existing.length
    ? existing.map((g) => `- id: ${g.id} | ${g.titleHe} | ${g.titleEn}`).join("\n")
    : "(none yet)";
  return `You review questions asked in a water-technology company's internal knowledge center, to find knowledge the company is missing.

A team member asked a question and the knowledge base produced the answer below.${c.notHelpful ? "\nThe team member marked this answer as NOT helpful." : ""}

Question:
${c.question}

Answer given:
${c.answerText || "(no answer text)"}

Decide "kind":
- "answered": the answer fully resolves the question from the knowledge base.${c.notHelpful ? " (Do not pick this: the team member said it did not help.)" : ""}
- "partial": part of the question is answered and part is missing from the knowledge base.
- "no_info": the knowledge base has no information on the question.
- "off_topic": the question is not about the company's work, product, procedures or customers (small talk, weather, general trivia, personal requests).

For "partial" and "no_info", name the missing knowledge as a short topic title (3-8 words) that a knowledge owner would fill with a document: "gapTitleHe" in Hebrew and "gapTitleEn" in English. Name only the missing part, not the whole question. For other kinds use empty strings.

Existing gaps (some may be marked not-a-gap; still match to them):
${list}

If the missing knowledge is the same topic as an existing gap - even if worded differently or in another language - set "matchesGapId" to that id. Otherwise null.`;
}
