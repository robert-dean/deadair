---
'@deadair/plugin-sdk': minor
---

A new `podcast` capability lets a plugin say what programmes the station subscribes to and what each has published: `listShows`, `listEpisodes` (newest first, each episode carrying the address of its audio, how long it runs by the publisher's account, and its summary), and an optional `searchShows` directory. The plugin never fetches the audio; the station fetches it itself, ahead of the slot it airs in. It is deliberately not a music provider, because an episode is not a record, and the README's new "Carrying podcasts" section says why.
