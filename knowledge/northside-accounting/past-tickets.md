# Northside Accounting past tickets

## Ticket 2026-005: Raise the Growth plan price
Request: "Growth goes up to $349 from March."
Resolution: Updated the `price` of the Growth plan in `src/data/plans.json`. The pricing section
reads from that file.

## Ticket 2026-018: New FAQ about software
Request: "Add a question about which accounting software we use."
Resolution: Added an object with `question` and `answer` to `src/data/faq.json`.

## Ticket 2026-033: Saturday hours for tax season
Request: "We open Saturdays 10 to 2 from February to April."
Resolution: Added an entry to `hours` in `src/data/business.json`; it appears in the footer.
