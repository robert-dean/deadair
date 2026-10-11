---
'@deadair/api': patch
---

A model-written break that failed part-way now records what its finished steps cost. The Scripts page's Tokens figure was blank for an attempt that spent a generation and then hit a provider error, so a failing model read as free. The figure is a floor: the generation that failed is never counted, and an attempt that failed on its first step still shows none.
