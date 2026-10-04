# Changelog

Sectioned by Sprint (the team's Scrum terminology) once Sprint 1 actually
starts (2026-09-21 per the plan); anything before that date falls under
Iteration Zero, matching the Charter. Not semver.

## Sprint 1 – Stabilised foundation (2026-10-01)

### Added
- Imported 72 real Auckland borrow/rent/repair locations from a manually-compiled spreadsheet (geocoded via free OpenStreetMap Nominatim, no API key), replacing the 4 placeholder sample records
- Added a new "event" category: 26 one-off community events pulled from The Auckland Bagel newsletter, rendered with a distinct orange pin so they don't read as permanent reuse options alongside the green service pins
- "Get directions" link in every map pin's popup — builds a Google Maps directions URL to that pin, using the "Find near me" location as the origin when available, otherwise letting Google Maps ask the device for its current location itself
- "View full details ↓" link in every map pin's popup — smooth-scrolls down to that record's full card in the list below
- Attribution footer crediting The Auckland Bagel as the source for event listings

### Changed
- Event records' "View source" link now points to each event's own official page (Ticketmaster, Eventbrite, Auckland Live, Stardome, Eden Park, etc.) instead of the generic Auckland Bagel newsletter URL
- Event descriptions rewritten in our own words with a one-line emoji summary, instead of the sparse single phrase each record started with — fee/eligibility are only filled in where the source explicitly stated them (e.g. "Free", "18+"), nothing invented

### Fixed
- MapLibre's popup text was unreadable in dark mode — the popup card has a hardcoded white background but set no text color of its own, so it inherited the page's light dark-mode foreground color
- The `notes` field was never actually rendered anywhere in the UI, for any record in any category — this, not a lack of content, was the real reason cards (especially Event ones) looked sparse. Every card now shows its description line.

### Tested (manual, 2026-10-04)
Verified live against the real 98-record dataset, in both Chrome and Firefox:
- Each of the 5 category filters individually (`repair`, `borrow`, `rent`, `used`, `event`) — all filter correctly; `used` correctly shows the "No matches" empty state rather than erroring, since it has zero real records (see Known gaps below)
- Keyword search ("bike") and suburb search, standalone and combined with a category filter — both match correctly against the real data
- "Find near me": location-granted path shows the "Showing results sorted by distance from you." note, re-sorts the list ascending by distance, and renders a distinct user-location pin on the map — confirmed in Chrome and Firefox
- "Find near me": location-denied/unavailable path falls back to "Couldn't get your location... Use the suburb search instead." without breaking search/list — confirmed in Chrome

### Known gaps
- The 72 imported locations and 26 events are all `status: "unconfirmed"` — desk-researched and geocoded, not in-person verified
- 6 of the 26 event pins only have suburb-level accuracy (exact venue address isn't published anywhere) — flagged individually in each record's `notes`
- Event records' "Source:" label still reads "The Auckland Bagel" even though "View source" now points to the event's own page — open question on whether to update it to match
- The `used` category has zero real records (0 of 98) — the filter itself works and is tested, but selecting "Used purchase" always returns an empty list until real used-goods listings are sourced

## Iteration Zero – Technical Prototype and Baseline (2026-09-16)

### Added
- Initial prototype: search by item/suburb/category over a single `data/services.json` source of truth (US02–US04)
- Data schema + `scripts/validate_data.js` validation workflow (T3)
- Map view (search-synced markers) and "Find near me" geolocation distance sort (US07, US09 spikes)
- Self-hosted "Suggest a listing" form with a pre-moderation review queue, no account system (US10 spike)
- Deployment via `nix develop` + tmux on the team server, port 3417

### Changed
- Map provider: Leaflet + OpenStreetMap (raster, originally planned) → CARTO Voyager (raster, turned out to require an API key) → MapLibre GL + OpenFreeMap "liberty" (vector, free, confirmed working)

### Fixed
- Map wasn't re-centering after search/filter changes
- Tile-failure detection was one-flaky-load-and-done; now requires repeated failures within a time window before falling back to list-only
- Synonym search terms (e.g. "hire") weren't actually matching category
- `source_url` accepted non-http(s) values (self-XSS risk via `javascript:` links) — now validated at intake, in the data-validation script, and at render time
- `flake.nix` was hardcoded to `x86_64-linux`, which broke `nix develop` on the team's aarch64 server

### Known gaps
Not urgent, not tracked anywhere else — just noted here for whenever they matter:
- All data is placeholder (`unverified-sample`) pending T2's real 20-verified-record dataset — this single gap blocks US01, US03, US04, US05 and US06 from moving past "Partial"
- No filter-reset control (US08)
- List and map currently show simultaneously rather than toggling between views as US09 describes — needs a product decision on whether that satisfies the story
- No agreed process yet for who reviews `data/pending_submissions.json` or how often (US10)
- Single point of failure: only deployed on one server (Charter risk: "avoid reliance on one server or member")
