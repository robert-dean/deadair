---
'@deadair/web': patch
---

The console is now served with security headers: a Content-Security-Policy, `X-Frame-Options: SAMEORIGIN`,
`X-Content-Type-Options: nosniff` and `Referrer-Policy: same-origin`. The policy allows scripts only from the station
itself and allows the console to be framed only by the station's own pages, so a page elsewhere can no longer embed
the console in a frame to trick someone into clicking inside it. If you showed the console inside another dashboard's
iframe, that dashboard's page is now refused. The stream, HLS and TuneIn URLs players fetch are unchanged, and so is
the API.
