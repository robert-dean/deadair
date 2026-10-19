---
'@deadair/api': patch
'@deadair/web': patch
---

Trends' "Average call" for the model now averages only the calls the model answered. A timeout used to count its full two minutes, so one among twenty quick answers read as a model three times slower than it was, and a model that was down and refusing instantly read as a fast one. "Calls" still counts both, and "Failed" beside it says how many did not answer. The station now labels each model call's duration with whether it answered.
