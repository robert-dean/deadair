---
'@deadair/plugin-sdk': patch
---

The plugin SDK reads a multi-line config field as a list (`configLines`) and an on/off field as a boolean (`configFlag`), so the chat plugins and Chatterbox no longer each carry their own copy.
