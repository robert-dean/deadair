---
'@deadair/api': minor
'@deadair/sdk': minor
'@deadair/web': minor
---

Kinds of break move between stations as files. On Voice, Kinds of break, **Export all** saves every kind you have written as one file and each row exports its own; **Import** reads a file, shows what it would do first (new, kept, replaced, or not allowed for a key the station uses for its own breaks), and lets you choose to replace a kind you already have. Everything an import writes arrives switched off, so you read it back before it airs. On the API: `GET /breaks/kinds/export`, `GET /breaks/kinds/{id}/export`, `POST /breaks/kinds/import/preview` and `POST /breaks/kinds/import`.
