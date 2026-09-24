---
'@deadair/api': patch
---

A station that updated to the chat-platform release before the playlist import release can now import playlist-file lines that name a record without a provider's id; the database change that allows them had been skipped. A new install migrates from scratch again instead of stopping at startup.
