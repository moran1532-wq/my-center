# Phase 2 Plan
1. server: @anthropic-ai/sdk; AnswerService (builds request: system prompt, document blocks w/ citations + cache, history), ConversationStore (in-memory), Retriever (all docs)
2. API: POST /api/ask {conversationId?, question, lang} → {conversationId, answer: [{text, citations}], sources: [{id,title,type,passages[]}]}
3. client: Ask page (main), chat thread, sources side panel, New question button, Browse tab (existing list)
4. Tests with fake client: request shape, citation→source mapping, follow-up keeps history, rate limit/size limits
5. Live check with a real key once the owner provides it
Done when: question in he/en gets a full answer with sources on the side; follow-up works; partial coverage states what is missing.
