---
'@deadair/api': patch
---

When the model runs out of time before choosing a set, the station now fills the hour only with records that match what the model searched for. Before, it took one record from every artist the searches had turned up, including records that only contained the search inside another word, so a heavy-metal hour whose model searched for Dio aired "Mr. Vain - Original Radio Edit" and other radio edits. If nothing the searches found matches, the refill moves on to the station's other sources, as it did before this fallback existed.
