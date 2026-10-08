---
'@deadair/api': patch
---

When the model searches for records and then fails to name any, the hour the station fills from those searches now takes a record from each artist it searched for in turn, instead of filling up on the first one or two artists and losing most of them to the per-artist limit.
