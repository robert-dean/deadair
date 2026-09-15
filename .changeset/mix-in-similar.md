---
'@deadair/api': minor
'@deadair/web': minor
'@deadair/sdk': minor
---

A playlist can now be aired with similar records mixed in, the way Spotify's smart shuffle does it. Every few records of the playlist, the station adds a record by an artist who sounds like the one just played, found through a similarity plugin such as Last.fm; the playlist itself still plays in full and in its own order around them. Choose **Air with similar records mixed in** from the arrow beside Air this playlist, or turn on **Mix similar records into a playlist** under Settings, Rotation to have every playlist do it, with the spacing beside it (four of the playlist's records between mixed-in ones by default). It is off by default, a setlist or a feature never has anything mixed in, and every mixed-in record passes the same rules and dislikes as anything else the station picks. A mixed-in record never lands beside a break, so nothing the presenter has already said about the next record is made wrong. The activity feed says how many were found, and says so when none could be. `PutOnAirInput` and `PlayoutPlaylistInput` gain an optional `mixInSimilar`.

On the Desk, a record the station mixed in carries a **mixed in** badge, so you can tell it from the ones the playlist named. `StationOrderItem` gains an optional `mixedIn`.
