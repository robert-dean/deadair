---
'@deadair/plugin-sdk': minor
---

`parseFeed` reads what a podcast feed carries. An entry now reports its audio attachment as `enclosure` (from RSS `<enclosure>` or an Atom `<link rel="enclosure">`, preferring an audio one, http(s) only), how long it runs as `durationMs` from `itunes:duration`, and its artwork, explicit marking, season and episode number. A feed reports its own description, author, artwork, language, categories and explicit marking. Every field is optional, and `url` is still only ever the page, so a news reader sees exactly what it saw before.
