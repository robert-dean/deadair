---
'@deadair/api': patch
---

The presenter now says weather units as words. `12°C`, `41°F`, `15 km/h` and `20 mph` used to reach the speech engine as written, so each engine read them its own way or skipped them. They are now said as "12 degrees Celsius", "15 kilometres per hour" and so on (singular after exactly 1). A unit with no figure in front of it is left alone. This applies to English stations only, like the other symbols.
