---
'@deadair/api': minor
'@deadair/sdk': minor
---

`PUT /auth/password` sets or changes the signed-in person's own password (`sdk.authentication.factors.setPassword`). It needs the current password when there is one, unless a sign-in link was used in the last ten minutes, and a recent authenticator or passkey once one is enrolled. Every other session of the account is signed out, and each of its email addresses gets a notice that the password changed.
