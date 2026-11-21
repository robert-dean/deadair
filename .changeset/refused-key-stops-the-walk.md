---
'@deadair/api': patch
'@deadair/plugin-lastfm': patch
---

When a source of facts refuses its key, the station stops asking it. A refused Last.fm key used to cost a failed request, a warning in the log and a failure recorded against every artist, record and track the station looked up, on every pass; now the first refusal sets the plugin aside, and the plugin page and the check-up show why. Saving its settings brings it back at once, and the station also tries it again once a day, so a key that starts working again (a renewed Last.fm Pro subscription, say) recovers without a save. Everything it collected before stays in use. Last.fm's "suspended API key" is now reported as a key problem too, both while the station runs and on Test connection.
