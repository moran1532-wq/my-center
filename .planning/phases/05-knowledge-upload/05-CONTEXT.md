# Phase 5: Knowledge Upload - Context

## Locked decisions (owner approved, 2026-10-21)
1. Where: "Upload document" on each gap + general "Add document" in Browse
2. Inputs: PDF, Word, text, HTML (owner), link (owner; only from approved hosts), or pasted text
3. Claude suggests title, type, topic; the owner confirms or edits
4. Every document is auto-translated to the other language
5. Claude checks the document answers the gap's questions; yes → gap closes; no → explanation, owner decides
6. "Closed" list in the gaps tab + "Closed since last report" section in the report

## Technical decisions (Nehemiah)
- Two steps: preview (extract text + Claude analysis, nothing saved) → commit (translate + save + close gap)
- Uploaded items in a separate file (data/uploaded.json), merged with the sample base; isSample=false; link kept as sourceUrl
- Extraction: pdf (unpdf), Word (mammoth), HTML (strip tags/scripts → text), text; 10 MB file cap, 60k chars text cap
- Links: http(s) only, host must be in LINK_ALLOWED_HOSTS, redirects re-checked, 10 s timeout, 5 MB cap
- Claude: analysis = structured output (title/type/topic he+en, source language, answers-gap verdict); translation = separate streamed call
- Gap gets status "closed" + closedAt + closedByItemId
- Preview: text, HTML and pasted text only (PDF/Word/link need the server)
