---
'@deadair/api': minor
'@deadair/sdk': minor
'@deadair/web': minor
---

A character can now be several kinds at once. Each persona has `kinds`, the set of things it may be cast as (`host`, `caller`, `guest`, `newsreader`), alongside the single `kind` it had before, so one character can host a show and drop by somebody else's without being written twice. Anybody with `host` can present; anybody with `caller` or `guest` can be cast into a phone-in or a visit, and their ties to hosts work as they always did; the newsreader may host too, and still reads every bulletin alone. Nobody is cast onto a show they are presenting that night. `kind` is still answered and still accepted: it is the kind in the set that ranks highest, host first, so a client built before `kinds` reads the answer it always did, and a client that sends only `kind` gets a character of that one kind.

On Voice, Characters, a character's editor has **What they do**, with a box for each job (Hosts, Rings in, Reads the news, Drops by), and a character who does several is listed once with a badge for each of the others. The ties to hosts are worded "Drops by" for somebody who only drops by.

An exported character file is now `deadair.persona/3` and carries `kinds`. A `deadair.persona/2` file still imports as it stands, its `kind` read as a character of that one kind, and the import preview badges every job a character does besides hosting.
