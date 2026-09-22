---
'@deadair/api': minor
---

The station can play jingles between records. **Settings > Rotation > Minutes between jingles**, which
is **off** (zero) until you set it.

A jingle is a few seconds of the station saying its own name between two records. It never lands next
to a break, and a break always gets the gap first. If you have jingles recorded, drop them in the
segment inbox's `jingle` folder or upload them on the Segments page with the kind `jingle`, and the
station plays those, never the same one twice running. With none recorded, it says one of its own
lines (**What the station says in a jingle**, under the same settings), ending on a sound from the
presenter's soundboard if they have one. The lines only ever say the station's name and the
presenter's, never a record or the time of day.

A listener who tunes in just before a jingle hears it as their welcome, and the station does not greet
them a second time on top of it. A `jingle` rule on the format clock still works for a different rate
at different times of day.
