# Demo corpus run — Bright Harbour Pte Ltd (synthetic)

Run at 2026-09-21T15:32:45.761886+00:00

**This is a fictional company and a synthetic document set** (WINNING.md's "clearly-labelled active-SME corpus"), used in place of the team's real documents for privacy. The numbers below are real system output against real gateway calls — only the input documents are made up.

## Documents processed

| File | Status | Lane / doc_type | Notes |
|---|---|---|---|
| 01_certificate_of_incorporation.pdf | processed | statutory / ACRA Certificate of Incorporation | obligations_created=2 |
| 02_constitution.pdf | processed | statutory / constitution | obligations_created=0 |
| 03_notice_office_change.pdf | processed | statutory / ACRA Notice of Change of Registered Office | obligations_created=0 |
| 04_notice_corpsec_change.pdf | processed | statutory / Notice of Appointment of Company Secretary | obligations_created=0 |
| 05_invoice_clean.pdf | processed | invoice / tax_invoice | obligations_created=0 |
| 06_invoice_bad_gst.pdf | needs_review | ? / ? | review: Please confirm: GST 84.0 is not ~9% of subtotal 1200.0 (expected ~108.00) |
| 07_invoice_injection_attempt.pdf | quarantined | ? / ? |  |
| 08_lease_important.pdf | processed | important / Office Lease Agreement | obligations_created=0 |

## Gap analysis: 2 of 6 expected documents held

| Expected document | Status |
|---|---|
| Register of Members / Share Register | missing |
| First Annual Return | missing |
| Statutory Registers (members, directors, charges) | missing |
| Last 3 years of AGM/Board Minutes | missing |
| Certificate of Incorporation | satisfied |
| Company Constitution | satisfied |

## Obligations derived (statutory clock)

| Obligation | Due | Status | Citation |
|---|---|---|---|
| File Annual Return | 2026-07-31 | open | Companies Act s197 — Annual Return due within 7 months of FYE. Dormancy does not exempt this; AGM/FS exemption is separate (s175A dispensation, s201A audit exemption). |
| File Form C-S/C | 2026-11-30 | open | Income Tax Act — Form C-S/C due unless IRAS has granted a filing waiver for the dormant company. |

## Summary

- Documents processed: 8
- Quarantined (injection guardrail fired): 1
- Sent to human review queue: 1
- Expected documents held vs expected: 2 of 6
- Missing: 4
- Obligations derived: 2
- Total LLM cost across the run: $0.1246 USD (app/llm.py placeholder pricing, not the gateway's confirmed billed rate)
- Trace rows written: 33
