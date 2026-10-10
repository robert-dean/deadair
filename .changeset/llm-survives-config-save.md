---
'@deadair/plugin-llm': patch
---

Saving the model plugin's settings while a break was being written no longer counts against the plugin. A generation already under way now finishes, or fails with the provider's own reason, instead of failing with "used before init() or after dispose()", which the station counted as the plugin breaking and, three times over, took it off air.
