---
'@deadair/api': minor
---

A break the station writes can now air over its show's music bed. Nothing changes until the library holds a recording of kind `bed`, and a show can keep its breaks dry from the Sound section of its editor. When a break is planned, the station picks a bed for it: one scoped to the show or its presenter first, otherwise one scoped to nobody, never another show's. The render lays the finished words over that bed, starting a moment before the first word and fading out after the last, at `render.bedLevelDb` under the voice (eighteen by default, judged from the bed's measured loudness). A break with a bed is never talked over a record. With no bed, no mixer, or anything going wrong, the break airs as words exactly as before.
