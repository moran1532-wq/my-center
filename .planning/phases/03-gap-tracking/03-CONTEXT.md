# Phase 3: Gap Tracking - Context

## Locked decisions (owner approved, 2026-10-21)
1. A gap = question with no info in the base, or the missing part of a partial answer
2. Claude merges similar questions into one gap and counts them, across languages
3. New tab "Knowledge gaps": most-asked first, with example questions and last asked date
4. "Answer didn't help" button under each answer → adds the question to gaps
5. (owner's addition) "Not a gap" button on each gap → leaves the list and the report; similar future questions do not reopen it
6. Questions unrelated to work are not logged

## Technical decisions (Nehemiah)
- Gap analyzer: second Claude call after each answer (claude-opus-5-5, effort low, structured JSON output): classifies answered / partial / none / off_topic, names the missing part (he + en title), matches to an existing gap (open or dismissed) or creates one
- Runs after the answer is returned, so it never slows the answer; failures are logged, not shown
- GapStore interface; v1 = JSON file (persists across restarts)
- Gap keeps: titles he/en, status (open / dismissed), count, last 5 example questions, first/last asked
- Preview: analyzer via claude.ai runtime, gaps kept in the browser
