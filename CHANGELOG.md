# Changelog

Sectioned by Sprint (the team's Scrum terminology), not semver, to match how progress is tracked elsewhere in the project. "Iteration Zero" in the Charter refers to the pre-Sprint planning phase this prototype work happened during.

## Sprint 1 – Stabilised foundation (2026-09-16)

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
- "Find near me" only tested in Chrome so far; not yet cross-browser tested
- Distance sorting is only explained in a code comment, not shown to users (US07 asks for the logic to be "disclosed")
- No agreed process yet for who reviews `data/pending_submissions.json` or how often (US10)
- Single point of failure: only deployed on one server (Charter risk: "avoid reliance on one server or member")
