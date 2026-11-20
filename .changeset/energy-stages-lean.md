---
'@deadair/api': patch
---

A show can now build up or wind down. Give a schedule slot energy stages (through the API for now; the console's editor follows), such as low, medium, high, and each stretch of the show leans toward the calmer, middle or more energetic third of the records it is choosing between, measured from their audio. It is a lean, never a filter: every record can still air. On a show with a brief, it reaches only the records the station tops up with until the model is told the stage too.
