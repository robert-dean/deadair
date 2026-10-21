---
'@deadair/web': patch
'@deadair/streamdeck': patch
---

Skip in the console and on the Stream Deck now names the record it was showing. If that record finished in the seconds before the press reached the station, nothing is skipped, and you are told so ("That had already finished, so nothing was skipped." in the console, the warning triangle and a line in the log on the deck). Before, the press cut the record that had just started.
