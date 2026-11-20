---
'@deadair/plugin-sdk': patch
'@deadair/api': patch
---

The station now measures your whole library once more, in the background, so every record gets a tempo and a brightness rather than only the ones added since those arrived. New records still go first, and every record keeps its cue points and level while it waits its turn. Expect it to take about two weeks on a library of 7,000 records, most of it the tempo; the analyzer runs at low priority throughout. If you run the analysis sidecar as its own container rather than in the single image, update it too, or its connection test will say it measures an older version.
