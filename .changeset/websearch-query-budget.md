---
'@deadair/plugin-websearch': patch
---

Web search answers the model again. Every search a break writer or a background walk made came back empty without an engine being asked, because the plugin wanted a full 8 seconds left on a call whose whole deadline is 8 seconds. The connection test never made that check, so it kept passing. A query now starts with 1.5 seconds or more in hand, and what is left of the call still caps it.
