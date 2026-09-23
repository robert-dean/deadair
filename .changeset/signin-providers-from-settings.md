---
'@deadair/api': minor
'@deadair/web': minor
---

Signing in through an identity provider is set up in the console now, under Settings, Sign-in and connections, rather than through two environment variables that only knew about Google. Add a row per provider: Google, Authelia, Authentik, Keycloak, Microsoft or anything else that speaks OpenID Connect, with its issuer, client id and client secret. The secret is stored encrypted and never shown again. Each provider's redirect address is your station's public address followed by /api/auth/login/oidc/callback.

A station that had GOOGLE_OIDC_CLIENT_ID and GOOGLE_OIDC_CLIENT_SECRET set copies them into that list once, at its first start after this upgrade, and says so in its log. The variables are not read after that and can be removed. The unraid template no longer has the two Sign-in fields.

Beside the providers is the list of addresses and domains allowed to create an account through one.
