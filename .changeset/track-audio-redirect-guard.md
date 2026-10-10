---
"@deadair/api": patch
---

Playout: follow a track's audio redirects by hand and refuse a redirect that resolves to a private address, for consistency with the podcast and art fetchers. The first resolved address is still fetched as before, so a record served from an operator's own Navidrome or a station-side helper keeps working.
