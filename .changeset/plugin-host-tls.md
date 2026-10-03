---
'@deadair/plugin-sdk': minor
'@deadair/api': minor
---

Plugins can open a TLS connection to a device on your network (`host.tls`), under the same allowlist, rate limits and clean-up as their web requests. It is what a plugin needs to control a Chromecast, which speaks its own protocol over TLS rather than HTTP.
