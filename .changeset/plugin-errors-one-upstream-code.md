---
'@deadair/plugin-sdk': patch
'@deadair/api': patch
'@deadair/plugin-deezer': patch
'@deadair/plugin-lastfm': patch
'@deadair/plugin-navidrome': patch
'@deadair/plugin-spotify': patch
---

A plugin error now carries its upstream's own failure code in one place, `PluginError.upstreamCode`, which takes a number or a string. The Deezer, Last.fm, Navidrome and Spotify plugins each kept that code in a field of their own (`apiError`, `subsonicCode`, `reason`), where it was lost when the host wrapped the error. They now set it with `withUpstreamCode`. The host logs it beside the upstream status when a plugin call fails a request, and never sends it to a client.
