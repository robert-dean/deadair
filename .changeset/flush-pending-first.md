---
'@deadair/api': patch
---

Clearing the audio chain's queue no longer trips an internal error in the audio chain. When the queue held a record ready to play and another waiting behind it, clearing them could start the waiting one downloading just before it was thrown away, and the audio chain logged an assertion failure. It now clears the waiting records first.
