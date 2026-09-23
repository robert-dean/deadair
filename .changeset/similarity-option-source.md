---
'@deadair/plugin-sdk': patch
---

A plugin setting can offer the station's similarity sources as its choices (`optionsFrom: 'plugins.similarity'`).
The type allowed it, but the check a plugin's manifest passes at load did not, so a plugin that asked for
it was refused and never started.
