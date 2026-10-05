---
'@deadair/plugin-weather': patch
---

The weather tool answers the model again. Every reading a break asked for came back empty unless one was already cached, because the plugin wanted a full 8 seconds left on a call whose whole deadline is 8 seconds. A read now starts with 1.5 seconds or more in hand, and what is left of the call still caps each request.
