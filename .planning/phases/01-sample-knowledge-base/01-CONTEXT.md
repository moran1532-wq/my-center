# Phase 1: Sample Knowledge Base - Context

## Locked decisions (owner approved all recommendations, 2026-10-21)
- Company: Wint (wint.ai) - AI water management: leak detection, abnormal consumption, automatic shutoff, for buildings and construction sites.
- 12 mock items, each clearly marked "לדוגמה בלבד":
  - 5 procedures: unit installation on main water line; handling a leak alert; automatic shutoff and reopening; unit communication loss; routine maintenance
  - 4 customer answers: why was my water shut off; alert but no leak; viewing consumption in the app; adding a user
  - 3 documents: product spec; new customer onboarding guide; alert types and meaning
- Fields per item: title, type (procedure / document / customer answer), topic, last updated date, owner
- Browse: list + filter by type + quick word search + click opens full item
- Hebrew, RTL

## Technical decisions (Nehemiah)
- client: React + Vite + TypeScript
- server: Node + Express + TypeScript - needed from phase 2 (Claude key must never reach the browser)
- Storage behind a repository interface (KnowledgeStore); v1 = JSON file adapter, so company DBs can be plugged in later
- Deviation logged: research-before-plan skipped for this phase (simple, no unknown technical decision)

## Deferred
- (none)
