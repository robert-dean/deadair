---
'@deadair/android': minor
---

Signing in can now finish with a passkey. When the account has one, the app asks for it with the phone's own passkey prompt after the password, with an emailed code or the authenticator still on offer beside it. It needs a station published over https, since that is where Android checks the app may use the station's passkeys.
