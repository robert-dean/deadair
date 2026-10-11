---
'@deadair/web': patch
---

A console page left open after its session ends no longer keeps asking the station for updates. The Desk, the checkup page, the cast menu and the presenting banner used to poll every few seconds regardless, and one open Desk was refused 2,680 times in 43 minutes. When the session ends, the console now checks straight away: if the sign-in can be renewed it stays on the page, and otherwise it goes to sign-in and comes back to the same page afterwards.
