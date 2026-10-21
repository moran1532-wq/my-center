# Phase 6: Cost Meter And Smart Search - Context

## Locked decisions (owner approved all recommendations, 2026-10-21)
1. Costs visible to knowledge owners only: top of Reports tab (month to date) + in every gap report
2. Send Claude up to 6 most relevant documents; if nothing is close, still the 6 closest - Claude decides
3. Below 20 documents, Claude reads everything (as today); smart search switches on automatically above that

## Technical decisions (Nehemiah)
- Usage meter: every Claude call records model + tokens (input, cache write, cache read, output) + cost in USD from a price table; kinds: answer, gap_check, doc_analysis, translation
- Price table per model (Opus 5.5: $4 in / $20 out / $5 cache write / $0.20 cache read per MTok); unknown model priced as Opus 5.5
- Search: BM25 over title + topic + body in both languages; Hebrew normalization (drop niqqud, punctuation; index words with and without one-letter prefixes ו ה ב ל מ ש כ); pure shared code so the preview uses it too
- Preview cannot measure cost (claude.ai does not report tokens) - says so on screen
