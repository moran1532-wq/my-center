# Requirements

- KB-01: Mock knowledge base - procedures, documents, customer answers about a water product
- KB-02: Screen listing knowledge items, viewable
- QA-01: User asks a question in free text (Hebrew)
- QA-02: Claude composes a full answer that resolves the question - no need to open the document
- QA-03: Source document(s) shown on the side of the answer
- QA-04: Answers grounded only in the knowledge base
- GAP-01: When no relevant knowledge exists, system says so honestly and logs the question
- GAP-02: Similar questions are grouped and counted
- REP-01: Every 3 days a gap report document is generated, sorted by frequency
- REP-02: Report reaches the responsible staff
- FILL-01: Responsible staff see open questions
- FILL-02: Staff upload a matching document (PDF, Word, text) to an open question
- FILL-03: Uploaded document enters the knowledge base immediately and closes the question
