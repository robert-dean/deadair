---
'@deadair/web': minor
'@deadair/api': minor
'@deadair/sdk': minor
---

The Library has a Podcasts tab. It lists the episodes the station knows about, newest first, with whether each is fetched, ready to air or aired, why a fetch failed, and a button to fetch one now or try again. It can read every feed again on request, and it can look a show up in Apple's podcast directory and subscribe to it, which adds the show to the Podcasts plugin's own list of feeds. `GET /podcasts/search` is the directory search behind it. Durations of an hour or more now read as hours everywhere in the console, including the desk's counters while a programme airs.
