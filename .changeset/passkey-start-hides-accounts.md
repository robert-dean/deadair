---
'@deadair/api': patch
---

Starting a passkey sign-in no longer tells anyone whether an address has an account. It used to answer differently for an unknown address, an account with no passkey and one with a passkey, with no limit on how often it could be asked. Now the first two get the same answer, and passkey starts share the per-address limit the emailed link and code already have.
