---
'@deadair/api': minor
---

`GET /nowplaying` now says what programme is on and who presents it, and whether the station is playing a record or talking. The new `show` field carries the broadcast's name and the host's on-air name: the persona's own on-air name, or the station's presenter name from Settings when the persona has none, and nothing when neither is set. The persona's console label is never shown. `track.kind` is `record` for music and `break` while the station speaks on its own between records, such as an ident, a bulletin or a talk break; during a break `artist` is empty and `title` is the break's label. A presenter talking over the start of a record still counts as the record. Both fields are additions, so existing players keep working, and a station on an older version reads as always playing a record with no show named. The route still answers without touching the database, so polling it costs the station nothing more than before.
