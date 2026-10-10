---
'@deadair/api': patch
'@deadair/sdk': patch
---

The lyrics the station has looked up can now be read by a signed-in app. `GET /catalog/tracks/{id}/lyrics` answers one record's words from the source the station believes, with the timing of each line when that source has it, or says the record is instrumental or that nothing has been found yet. `GET /catalog/tracks/{id}/lyrics/sources` lists what every lyrics source answered, and `GET /nowplaying/lyrics` answers the words of the record on air with when it started and where in the file it started playing, so a player can highlight the line being sung. All three are read-only, need the same sign-in as the rest of the catalog, are not offered to connected assistants, and serve only what "Look up the words of each record" has already fetched. The presenter is still never shown the words.
