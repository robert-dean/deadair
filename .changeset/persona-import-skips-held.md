---
'@deadair/api': minor
'@deadair/web': minor
'@deadair/desktop': minor
---

Importing a persona file no longer replaces a character you already have. A character in the file whose key matches one on this station is now skipped by default, and the import dialog in the console and the desktop app says so and offers Replace on that row. In the API, `POST /personas/import` and `/personas/import/preview` take an optional `replace` list of keys to rewrite, a plan entry's `outcome` can be `skip`, and the result counts `skipped`. A caller that relied on an import overwriting a matching character now has to name it in `replace`.
