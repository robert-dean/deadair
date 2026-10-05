---
'@deadair/api': patch
'@deadair/plugin-sdk': patch
'@deadair/plugin-analyzer': patch
---

Soundboard hits are now mixed at a level rather than at whatever their maker mastered them to. A pad the analyzer measured is set against the presenter's voice: a hit that plays over the words sits six decibels under them by default, which the new "Sit a hit under the words by (dB)" setting under Render changes, and a hit that plays between the words is matched to them. A short pad the analyzer could not put a loudness figure on, and every pad on a station with no analyzer, plays exactly as it did before.
