---
'@deadair/api': patch
---

Emptying a plugin setting that had a value now saves. The console sends a cleared field as `null`, and the host handed that straight to the plugin's own schema, so an optional number (Rhapsode's keep-alive, Chatterbox's idle unload, Navidrome's bit rate, the model's temperature) was refused with nothing but "Invalid input" under the box. A plain field sent as `null` is now removed, both from the form the schema judges and from what is stored, so the plugin reads it as not set.
