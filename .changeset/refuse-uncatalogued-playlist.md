---
'@deadair/api': patch
---

Airing a playlist none of whose records is in the library now refuses, instead of reporting the
station on air and playing only the bed. A record the catalog has never seen has no way to fetch its
audio, so an order made of nothing else was consumed without a sound. The console now says the
playlist is not in the library yet, and why: it is catalogued when its plugin syncs, and this one is
either not listed by the provider or was added since the last sync. A playlist with some records in
the library airs as before, and a catalog that cannot be read never causes a refusal.
