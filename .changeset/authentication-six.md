---
'@deadair/api': patch
---

The station moves onto version 6 of its sign-in library. Nothing about signing in changes. A token that refreshes a session for an account deleted since is still refused and its session revoked; that check now runs inside the refresh itself, because the new library refuses the quick look at the token it used to take first, and that look had quietly stopped checking anything. Google sign-in is wired the way the new library expects, and a test now builds the real sign-in wiring so a mistake there fails the build rather than the server at boot.
