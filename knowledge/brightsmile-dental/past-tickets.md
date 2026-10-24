# BrightSmile Dental past tickets

## Ticket 2026-012: New hygienist on the team page
Request: "We hired Hannah, can you add her to the team?"
Resolution: Added an entry to the `team` array in `src/pages/team.astro` with name, credentials
(RDH), role and bio supplied by the client.

## Ticket 2026-027: Emergency number changed
Request: "Our after-hours number is now 618 555 0199."
Resolution: Updated `emergencyPhone` in `src/data/business.json`. It is shown in the booking banner
on the home page.

## Ticket 2026-039: Online booking widget (declined)
Request: "Can patients book appointments directly on the site?"
Resolution: Out of scope for the Standard plan: it needs integration with the practice management
software. The agency offered a separate integration project.
