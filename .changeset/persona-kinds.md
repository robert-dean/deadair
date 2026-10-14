---
'@deadair/api': minor
'@deadair/sdk': minor
---

A character can now be several kinds at once. Each persona has `kinds`, the set of things it may be cast as (`host`, `caller`, `guest`, `newsreader`), alongside the single `kind` it had before. `kind` is still answered and still accepted: it is the kind in the set that ranks highest, host first, so a client built before `kinds` reads the answer it always did, and a client that sends only `kind` gets a character of that one kind.
