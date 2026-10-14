---
'@deadair/api': minor
'@deadair/sdk': minor
---

A character can now be several kinds at once. Each persona has `kinds`, the set of things it may be cast as (`host`, `caller`, `guest`, `newsreader`), alongside the single `kind` it had before, so one character can host a show and drop by somebody else's without being written twice. Anybody with `host` can present; anybody with `caller` or `guest` can be cast into a phone-in or a visit, and their ties to hosts work as they always did; the newsreader may host too, and still reads every bulletin alone. Nobody is cast onto a show they are presenting that night. `kind` is still answered and still accepted: it is the kind in the set that ranks highest, host first, so a client built before `kinds` reads the answer it always did, and a client that sends only `kind` gets a character of that one kind.
