---
'@deadair/api': patch
---

A break that was given no weather reading can no longer describe the weather. Most breaks are told not to reach for the weather to set a scene, but a model would still open with "sunny out there" during a storm, and nothing stopped it. Such a script is now refused and asked for once more without the weather, and falls back to the station's own phrasing if it does it again. Only words that describe the sky itself count (sunny, raining, overcast, a temperature in degrees), never "storm" or "clear", and a record called "Sunny" can still be named. English-language stations only.
