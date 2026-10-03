---
'@deadair/api': minor
---

A listener can now ask for a record the station does not hold yet. When the station's own library has fewer than three matches, the request search also asks the music providers (Spotify, Navidrome, YouTube Music) and offers what they carry, leaving out anything already shown, anything the station holds, and anything by an artist it dislikes. Such a record comes back with a `source` instead of a `trackId`, and a request sends that `source`: the station takes the record into its library, then decides on the request exactly as it would any other. Nothing is reached while `rotation.discover` is off, and each search term's provider answer is reused for a minute. Chat requests still search the library alone.
