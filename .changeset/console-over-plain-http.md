---
'@deadair/web': patch
---

The console works when it is opened over plain HTTP at a network address, such as `http://192.168.1.10:8080` on a home server. Before, every request it made failed in the browser before reaching the station, because the browser only offers one of the functions it used on HTTPS or on localhost, and the console reported that as "Can't reach the station". Enrolling an authenticator app or an email address from a console reached that way works too; it failed for the same reason.
