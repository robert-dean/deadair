---
'@deadair/api': patch
---

The stream no longer fails to start in a browser that holds a lot of cookies for the station's address. The station's web server used to pass every cookie the browser sent on to Icecast, which drops any request whose headers come to more than about 4 KB, so the player got a 502 and stayed silent. Cookies set by other apps on the same hostname or its parent domain count towards that, which is why the same stream played in a fresh browser profile or a command-line client and not in an everyday browser. Icecast never reads a cookie, so none is sent to it now. Nothing changes for players that were already working.
