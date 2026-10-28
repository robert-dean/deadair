---
'@deadair/api': patch
'@deadair/sdk': patch
---

`GET /catalog/similarity` answers who the similarity sources say resembles whom, as the station has stored it, as a graph of artists and the edges between them. Without `around` it answers the best-ranked edges of everything stored. With `around` set to a catalog artist it answers that artist's neighbourhood, one or two steps out, following edges in both directions. `library=true` keeps only artists the catalog holds. Edges are directed and carry each one's rank, which is the only weight that compares across sources. Each source's own score is passed through only for display. The answer comes from the store only and never asks a source, so an artist nobody has looked up has no edges yet.
