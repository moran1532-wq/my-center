# Phase 4: Gap Report - Context

## Locked decisions (owner approved, 2026-10-21)
1. Content: numbers on top (questions asked in the period, how many fully answered), then open gaps most-asked first, with examples and a "New" tag for gaps opened since the previous report
2. Format: HTML (owner's choice, over Word) - report in the email body and attached as an .html file
3. Delivery: email through the company mail server (they fill SMTP details), plus a "Reports" tab with report history
4. Recipients: one list of knowledge owners (name, email, language he/en), managed in a simple settings screen
5. Schedule: every 3 days at 08:00 Israel time, plus a "Generate report now" button

## Technical decisions (Nehemiah)
- Question stats: each analyzed question records only its outcome + time (no text) in a stats file
- buildReportHtml(): pure function, email-safe HTML (tables, inline styles), shared with the preview
- ReportService: snapshot of the data per report (stored as JSON), rendered per language on view/send
- Mailer interface; v1 = SMTP via nodemailer from SMTP_HOST/PORT/USER/PASS + MAIL_FROM env. Not configured → report is saved, marked "not emailed"
- Scheduler inside the server: checks every 10 minutes; due when 3 days passed since last report, at the next 08:00 Asia/Jerusalem; state in the reports file so restarts don't double-send
- Preview: reports generated in the browser, no email
