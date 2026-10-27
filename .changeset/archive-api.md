---
'@deadair/api': minor
'@deadair/sdk': minor
---

The station's recordings are on the API. `GET /archive/recordings` lists them, newest first, each with an audio URL a player can stream from without a token for twelve hours. `GET /archive/recordings/{id}/audio` answers a byte range at a time so a player can seek through an hour, or the whole file as a named download with `?download=true`. `DELETE /archive/recordings/{id}` removes a finished one and refuses one still being recorded. The storage report counts the archive as a store of its own, `archive`.
