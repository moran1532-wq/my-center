# Phase 2: Ask And Answer - Context

## Locked decisions (owner approved all 4 recommendations, 2026-10-21)
1. Ask box is the main screen; knowledge list moves to a second tab "Browse"
2. Sources on the side: up to 3 documents, each with the exact passage the answer relies on; click opens the full document
3. Partial coverage: answer what the knowledge covers, say explicitly what is missing (logged as gap in phase 3)
4. Conversation with follow-ups; "New question" button starts fresh

## Technical decisions (Nehemiah)
- Model: claude-opus-5-5 (default), effort "medium" set explicitly, adaptive thinking (always on)
- Grounding: knowledge items sent as plain-text `document` blocks with citations enabled; citations give cited_text + document index → mapped to item id
- Documents sent in the UI language; Claude answers in the language of the question
- Documents placed first in the conversation with cache_control → cached across follow-ups
- Conversation state kept on the server (full assistant content preserved, required for thinking blocks); in-memory store behind an interface
- Retriever interface; v1 = all documents (12 items, small). Switch to search-based retrieval when the base grows
- Server-side refusal fallback: fallbacks "default" (beta server-side-fallback-2026-07-01)
- Claude key only on the server (ANTHROPIC_API_KEY env), never in the browser
- Tests use a fake Claude client - no real calls in tests
