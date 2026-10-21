
## Milestone 2: Cost-efficient system

Goal: cut cost per question by 1/2 to 2/3 at the same or better answer quality; measure it.

- [x] **Phase 6: Cost Meter And Smart Search** - Measure cost per question; send Claude only the relevant documents
- [x] **Phase 7: Answer Memory** - Repeated questions answered instantly from memory; stale answers dropped when documents change
- [x] **Phase 8: Gap Check In Answer** - The answer call also tells whether there is a gap; no second call

### Phase 6: Cost Meter And Smart Search
<!-- קטע 6 - מד עלויות וחיפוש חכם -->
**Goal**: Every question's real cost is recorded and shown; only relevant documents are sent
**Depends on**: Milestone 1
**Plans**: TBD

### Phase 7: Answer Memory
<!-- קטע 7 - זיכרון שאלות חוזרות -->
**Goal**: Repeat questions answered from memory, invalidated when a source document changes
**Depends on**: Phase 6
**Plans**: TBD

### Phase 8: Gap Check In Answer
<!-- קטע 8 - בדיקת פער בתוך התשובה -->
**Goal**: One Claude call per question instead of two
**Depends on**: Phase 6
**Plans**: TBD
