---
'@deadair/api': patch
---

Signing in with Google now comes back to the station instead of the console's not-found page. The station told Google to return the browser to an address the console answers rather than the API, so the sign-in finished at Google and went nowhere. The address is now `<public address>/api/auth/login/oidc/callback`, and it is the one to register as the authorized redirect URI in the Google Cloud console: an OAuth client still registered with the old address is refused by Google until it is changed.
