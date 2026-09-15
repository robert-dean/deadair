---
'@deadair/api': minor
'@deadair/web': minor
'@deadair/sdk': minor
---

A schedule block that plays a playlist can now ask for similar records to be mixed in among it. The block editor shows **Mix in similar records** whenever the block plays from a playlist; ticked, every changeover to that block mixes neighbours in the same way Air with similar records mixed in does, and left unticked the station's own **Mix similar records into a playlist** setting decides. `ScheduleSlot` gains an optional `mixInSimilar`, stored in a new nullable `schedule_slots.mix_in_similar` column (migration 0029).
