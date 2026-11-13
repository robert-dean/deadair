---
'@deadair/plugin-sdk': minor
'@deadair/plugin-analyzer': minor
---

A mixer can lay a music bed under a join. `AudioJoin.bed` names a sound that runs under every part, from `leadMs` before the first word to `tailMs` after the last, at `gainDb`; the analysis sidecar loops a bed shorter than the words (with a short crossfade at each seam), cuts one that is longer, and fades it in and out across its edges. A join that sends no bed is unchanged, byte for byte.
