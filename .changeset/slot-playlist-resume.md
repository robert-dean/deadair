---
'@deadair/api': minor
'@deadair/sdk': minor
'@deadair/desktop': patch
'@deadair/web': minor
---

A schedule block that plays a playlist can pick it up where it left off. Switch on **Pick the playlist up where it left off** in the slot editor, and each time the block opens it starts with the record after the last one from its playlist that aired, rather than from the top, so a long playlist on a short block gets all the way through over several nights. An operator's takeover ending in the middle of the block no longer starts the playlist over. The editor shows the record the block will open on next, and **Start from the top** sends it back to the beginning; a record taken off the playlist, or choosing a different playlist, starts it from the top too. Through the API it is `resumePlaylist` on a slot, with `GET` and `DELETE /schedule/{id}/playlist-position`. The desktop app keeps the setting when it saves a slot.
