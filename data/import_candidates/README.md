# Import candidates — human review required

Files in this directory (`<source>-<date>.json`) are output from
`node scripts/import/run_import.js` — fetched, normalized, and deduplicated
against `data/services.json` and each other, but **nothing here has been
verified by a person**. Nothing in this directory is ever read by the app
itself; it only exists for review.

Same review process as the existing "Suggest a listing" flow
(`data/pending_submissions.json`, see the main `README.md`):

1. Open a candidate file and pick a record worth adding.
2. Copy its fields into a new entry in `data/services.json`.
3. Fill in whatever's listed in that record's `missing_fields` (commonly
   `suburb`, `address`, `conditions.hours`, `conditions.fee`) — look the
   place up yourself to confirm these, don't guess.
4. Set `checked_date` to the date you actually confirmed this (not the
   `fetched_at` date — that's just when the pipeline found it, not when a
   person checked it was still accurate).
5. Set `status` (`active`/`inactive`/`unconfirmed`) based on what you found.
6. Delete the `source_system`, `fetched_at`, and `missing_fields` keys —
   those are import metadata, not part of the published schema.
7. Delete the record from the candidate file once you've either used it or
   decided to skip it, so it doesn't get reviewed twice.
8. Run `node scripts/validate_data.js` before committing.

`.last_run.json` tracks when each source was last fetched (used by
`run_import.js`'s staleness check) — it's regenerated automatically, not
meant to be edited by hand.
