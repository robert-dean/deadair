---
'@deadair/api': minor
'@deadair/web': minor
---

The station can now delete media files that nothing points at any more. **Settings > Housekeeping >
Delete media files nothing points at**, which is **off** until you turn it on.

Records, cover art and the audio of everything the station has said are kept in folders named after
what the bytes hash to, with a row in the database pointing at each one. When a row goes without its
file going — a crash between writing the bytes and writing the row, or something deleted through the
API — the file is left behind, and nothing can ever reach it again, because everything that reads
one of these files starts from a row holding the name to ask for. Storage on the settings page has
counted those files for a while and deleted none of them. This is the half that deletes them.

Nothing that still has a row is touched, however old it is, and a file two rows share — the same
ident at three slots in an hour is one recording — is kept as long as either row wants it. The
voice previews are never swept at all: they are named after the question they answer rather than by
any row, so every one of them looks unclaimed and none of them is.

**A file is left alone until it has sat unclaimed for a day**, which you can change and cannot set
below an hour. That wait is the whole safety of it: a file being written right now has no row yet
either, for the moment between the two, and at that instant it looks exactly like one whose row has
gone. A day is far longer than anything the station does, since writing a break takes seconds.

The sweep runs nightly at 05:17 and puts one line in the activity feed when it removes anything,
under a new **Storage** filter. It will not run at all while the switch is off.
