---
'@deadair/api': minor
'@deadair/plugin-sdk': minor
---

Plugins can now tell whether the station is on air. `host.air.isOn()` answers it and `host.air.onChange` hears each change, where "on air" means the station has something to play and somebody to hear it, or the operator has told it to air regardless. It goes off when the running order runs out, when the station is stopped, and a few minutes after the last listener leaves. Nothing uses it yet; it is for a speech plugin that holds a model on a graphics card and should keep it while the station airs rather than guess from how long it has been since it last spoke.
