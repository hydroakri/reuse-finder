# Auckland Reuse Finder

ENGGEN 731 Group 4 prototype. A responsive website that compares nearby repair,
borrow, rental and used-purchase options for household items in Auckland. See
`../../02 Project Charter/` for the full Charter & Iteration 0 plan.

This is **not** a native app, doesn't hold real-time inventory, and doesn't
process payments/bookings/accounts — see the Charter's Out of Scope list.

## Adding or editing a data record

All service records live in one file: `data/services.json`. You do **not**
need to know how to code to edit it — it's a plain text file, one record per
entry, that you edit directly.

1. Open `data/services.json` in any text editor (or GitHub's web editor).
2. Copy an existing entry (the curly-braces block between `{` and `}`) and
   paste it as a new one, or edit an existing one directly.
3. Fill in every field — leave nothing blank. If you don't know a value yet,
   write `"unknown"` rather than deleting the field.
   - `category` must be exactly one of: `repair`, `borrow`, `rent`, `used`.
   - `status` must be exactly one of: `active`, `inactive`, `unconfirmed`.
     (`unverified-sample` is reserved for the placeholder demo entries —
     don't use it for real data.)
   - `checked_date` must be `YYYY-MM-DD` (the date you last confirmed this
     record is accurate).
   - `lat`/`lng`: look up the address on [openstreetmap.org](https://www.openstreetmap.org),
     right-click the exact spot → "Show address" / copy coordinates.
4. Save the file (GitHub's web editor lets you commit directly from the
   browser — no local setup needed). A check runs automatically on GitHub
   after you commit and tells you within a minute or two whether the file
   is valid.

## Validating data

Nobody needs to install or run anything locally to check an edit —
GitHub Actions runs `scripts/validate_data.js` automatically on every commit
that touches `data/services.json` (see the "Actions" tab on the repo, or the
✓/✗ next to the commit). It checks required fields are present,
`category`/`status` are one of the allowed values, `checked_date` is a real
date, and `lat`/`lng` fall inside the Auckland region (catches typos/swapped
coordinates). It also warns (but doesn't fail) on any leftover
`unverified-sample` placeholder entries — those must be replaced with real,
manually verified records before the Sprint 1 review.

If a check fails, open the failed run under the "Actions" tab to see exactly
which record and field it's complaining about, fix it in the file, and
commit again.

## Suggested-listing review queue

The public "Suggest a listing" form (`/submit`) never publishes directly —
submissions land in `data/pending_submissions.json` for human review. To
approve one: copy its fields into a new entry in `data/services.json`
(filling in `lat`/`lng`, which the form doesn't collect), set `status` and
`checked_date`, run the validation script, then delete the entry from
`pending_submissions.json`.

## Development setup

Requires [Nix](https://nixos.org/) with flakes enabled (already the case on
the team's dev machines). Nothing else needs installing — `nix develop` pins
the exact Node.js version.

```bash
nix develop                # drops you into a shell with the right Node.js
npm install                 # first time only, or after package.json changes
npm run dev                  # http://localhost:3417, hot reload
```

Port 3417 is hardcoded into the `dev`/`start` npm scripts (not the Next.js
default of 3000) to match the port already opened on the team's server — see
Deploying below.

## Building

```bash
nix develop --command npm run build
nix develop --command npm run start    # serves the production build
```

## Offline demo backup (for the actual grading demo)

The live site depends on the server being reachable. As a backup in case the
venue's network or the server is down on demo day, build a fully static,
double-click-to-open copy of the browsing/search/map pages (the "Suggest a
listing" form isn't included — it needs a live server, but a demo doesn't
need to accept real submissions anyway):

1. Temporarily move `app/api/` and `app/submit/` out of the project (e.g.
   into a sibling `_offline-excluded/` folder) — static export can't include
   a POST-only route.
2. Add `output: 'export'` to `next.config.mjs`.
3. Run `nix develop --command npm run build`. The static site is generated
   in `out/`.
4. Revert steps 1–2 (move `app/api/` and `app/submit/` back, remove
   `output: 'export'`) so the live server build isn't affected.
5. Copy the `out/` folder to the demo laptop. Open `out/index.html` directly
   in a browser — no server or network required. The map and "Find near me"
   will show their offline-fallback message (this is expected — see below)
   and the search/list/links still work fully.

## Deploying to the team server

The team is self-hosting on an existing NixOS server (no dedicated systemd
service — this was a deliberate choice to avoid touching any system-level Nix
config beyond the nginx port/domain that's already set up).

```bash
# On the server, inside a tmux session so it survives you disconnecting:
tmux new -s reuse-finder
cd /path/to/reuse-finder
nix develop --command npm run build
nix develop --command npm run start   # runs on the port nginx already proxies
# Ctrl-b, d to detach — the process keeps running in the tmux session
```

**If the server reboots or the process dies**, it will **not** restart on its
own (no systemd). Reconnect (`tmux attach -t reuse-finder`, or start a new
session with the commands above if the old one is gone) and run
`npm run start` again. Whoever is on deploy duty for a given iteration should
make sure this still works before a demo.

## Known offline/degraded behaviour (by design, not bugs)

- **Map tiles**: the map uses [OpenFreeMap](https://openfreemap.org)'s free
  "liberty" vector style via MapLibre GL (no API key/signup, chosen after
  CARTO's equivalent free raster tiles turned out to require a key — verified
  by testing, not assumed). If the style/tiles fail to load (offline,
  blocked, rate-limited) more than a couple of times, the map area is hidden
  and a message points to the list below instead — the list/search never
  depend on the map working.
- **"Find near me"**: uses the browser's Geolocation API, which requires
  HTTPS (or `localhost`) in modern browsers. Opening the offline static
  export via `file://` will not offer a working location fix, and the app
  falls back to manual suburb/keyword search automatically — this is
  expected, not an error.

## Maintenance note: MapLibre's worker files in `public/`

`public/maplibre-gl-worker.mjs` and `public/maplibre-gl-shared.mjs` are
copied as-is from `node_modules/maplibre-gl/dist/`. MapLibre GL decodes
vector tiles in a Web Worker that it locates via `import.meta.url` relative
to its own bundle — Next.js/Turbopack doesn't preserve that relative path, so
without these copied files the worker silently 404s and the map never
renders any vector data (no console error, easy to miss — the map still
shows a background colour and markers, just no roads/labels). `MapView.js`
points MapLibre at the copied files explicitly via `setWorkerUrl()`.

**If you ever upgrade the `maplibre-gl` package**, re-copy both files:

```bash
cp node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs public/
cp node_modules/maplibre-gl/dist/maplibre-gl-shared.mjs public/
```

If the map ever silently shows no roads/labels again (just a blank
background + markers), this is the first thing to check.

## Workflow

Progress against the Charter's backlog is tracked as **GitHub Issues** on
this repo (not yet Jira — that's still an open team decision). Each issue
title references the User Story or task it belongs to (e.g. "US08", "T2"),
so it stays traceable back to the Charter without duplicating the Charter's
content here.

- **Labels**: `must` / `should` / `could` / `wont` mirror the story's Charter
  MoSCoW priority; `data` marks anything blocked on the real 20-verified-record
  dataset (the single biggest recurring blocker right now).
- **Milestones**: one per Sprint (`Sprint 1 – Stabilised foundation`,
  `Sprint 2 – Complete discovery`, `Sprint 3 – Evidence-led refinement`).
- No owners are pre-assigned on issues — per team agreement, Developers pick
  up work during Sprint Planning rather than having it assigned in advance.
- See **`CHANGELOG.md`** for what's actually shipped, sprint by sprint, and
  each sprint's known gaps.
