---
'@deadair/api': minor
'@deadair/web': minor
'@deadair/sdk': minor
---

Settings, Security has a Linked sign-ins card. Link any identity provider the station offers to your own account, after proving it is yours at the provider, and sign in through it from then on. Unlink one the same way. The station refuses to unlink the only way an account can sign in, and refuses to link an identity that already belongs to somebody else's account, and says so on the card when it does. The SDK's factor registration takes `{ method: 'oidc', provider }` and answers with the provider's address.
