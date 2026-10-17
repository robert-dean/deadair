---
'@deadair/api': minor
'@deadair/sdk': minor
---

A sign-in link can be asked for as a password reset: `POST /auth/login/start` with `grant_type: 'link'` takes `purpose: 'reset'`, which emails "Reset your password" instead of "Sign in" and lands the person on the password form once the link has signed them in. The limit on how often an address can be mailed, and the answer for an address with no account, are the sign-in link's own.
