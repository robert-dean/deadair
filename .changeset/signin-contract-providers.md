---
'@deadair/api': minor
'@deadair/sdk': minor
---

A new public endpoint, `GET /auth/login/oidc/providers`, lists the identity providers a station offers for signing in, by name and button text. Starting a sign-in through one takes any provider's name rather than only `google`, and can carry `redirect_after`, a path on the console to return to afterwards; anything that is not a path on the console is ignored. The unused `OidcLoginStart` and `OidcLoginStartResponse` types are gone from the SDK.
