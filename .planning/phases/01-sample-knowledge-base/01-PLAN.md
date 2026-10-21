# Phase 1 Plan
1. Scaffold: /server (Express, TS) and /client (Vite React TS), root scripts to run both
2. KnowledgeStore interface + JsonKnowledgeStore adapter; seed file with 12 rich Hebrew mock items
3. API: GET /api/knowledge?type=&q= , GET /api/knowledge/:id
4. Client: RTL layout, list with type filter + search, item view page, "לדוגמה בלבד" badge
5. Verify: server tests for store + API; build client; manual run screenshot
Done when: 12 items browsable, filter and search work, item opens fully, all in Hebrew RTL.
