---
'@deadair/ios': patch
---

The host picker offers only characters who can present. It used to leave out callers alone, so a guest or the newsreader could be picked and refused; now it reads each character's `kinds`, so a host who also drops by somebody else's show is still offered, and anybody who cannot host is not.
