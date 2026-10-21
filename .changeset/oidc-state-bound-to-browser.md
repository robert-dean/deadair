---
'@deadair/api': patch
---

Signing in or linking through an identity provider (Google, Authelia and the like) now only completes in the browser that started it. Somebody can no longer send you a half-finished sign-in link that signs your console in as them, or links your identity to their account. If you start a sign-in in two tabs at once, the earlier tab asks you to start again.
