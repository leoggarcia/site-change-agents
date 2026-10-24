# Luna Café past tickets

## Ticket 2026-031: Update cold brew price
Request: "Cold brew is now 4.75, please update the menu."
Resolution: Changed the Cold Brew price in the `menu` array of `src/pages/menu.astro` from $4.50 to $4.75.
Deployed the same day. Content update, low risk.

## Ticket 2026-044: New Sunday hours
Request: "From May we close at 2 on Sundays."
Resolution: Updated the Sunday entry in `hours` in `src/data/business.json`. The footer and the
"Visit us" section both read from that file, so one change updated both.

## Ticket 2026-052: Add a new weekly special
Request: "Add the Morning Bun to the favorites on the home page."
Resolution: Added an item to the `specials` array in `src/components/Specials.astro` with name,
description and price. Kept three items so the grid stays balanced.

## Ticket 2026-060: Online ordering (declined)
Request: "Can customers order and pay online from the website?"
Resolution: Marked out of scope. Online ordering and payments are not included in the Basic plan.
The agency sent a separate quote for an e-commerce project.
