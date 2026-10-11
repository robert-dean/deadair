---
'@deadair/api': minor
'@deadair/web': minor
'@deadair/desktop': minor
---

A persona's quirks are rows now, each with how often it applies: Always, Often, Occasionally or Rarely. Every existing quirk is Always, so nothing a station says changes yet. In the API a quirk is `{ text, cadence }` rather than a string, and persona files are `deadair.persona/2`; the console still imports a `/1` file, upgrading its quirks as it reads it.
