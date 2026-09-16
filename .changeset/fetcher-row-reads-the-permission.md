---
'@deadair/api': patch
---

A station whose records come from Navidrome is no longer told it is not authorized to fetch audio. The desk's attention list decided which plugin feeds the station's track fetcher by looking for the `stream` capability, which Navidrome declares too — it puts records on air by minting its own URLs and has no use for the fetcher's Spotify login. Because the shim runs in every image and holds no stored login until somebody authorizes it, every Navidrome-only station saw a permanent `failure` row telling it to go and authorize a fetcher it never touches, routed at a plugin page that correctly offers no such card. The list now reads the `trackFetcher` permission, which is the fact the plugin page was already moved onto and the only one that says a plugin's audio goes through the shim.
