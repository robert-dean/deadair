---
'@deadair/api': minor
---

The station says so when the timetable changes the show. **Settings > Rotation > Say so when the show
changes**, which is **on** for any station that allows breaks.

Between the last record of the old show and the first of the new one, whoever presents the new show
thanks the last host by name when that was somebody else and names the show starting. A host carrying
on into their own next show just names it. When a block ends with nothing scheduled after it, the
station names the show that ended and carries on with what it plays between shows. Only a change the
timetable makes is marked: putting something on air yourself stays silent, and a block opening a
setlist or a feature marks nothing, since those take no breaks.

The lines are yours to change under **What the station says when the show changes**, with
`{{show.name}}`, `{{outgoing.show}}` and `{{outgoing.name}}` for the two shows and the last host. A
listener who tunes in just before one hears it as their welcome, as with a jingle.
