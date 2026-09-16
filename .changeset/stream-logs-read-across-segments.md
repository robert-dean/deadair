---
'@deadair/api': patch
---

The audio chain and track shim logs are read back across their rotated segments rather than only out of the active file. Nothing rotated them before, so the reader knew about one file; the image rotates them now, and a reader that still knew about one would show an operator LESS after rotation than before, and almost nothing in the minutes after a rotation — which is exactly when somebody is looking. `readSegmentedTail` walks `name.log`, `name.log.1`, `name.log.2` … newest first until the byte budget runs out, so the console's view is the newest 512 KiB (a tail) or 8 MiB (a download) of retained history wherever it happens to live, which is what the unbounded file used to give it. `measureSegments` sums the set for the size beside the source, because an operator told "8 MB" next to 32 MB of disk is being told the wrong thing about their own storage. The segments must stay uncompressed for this to hold, and the rotation config says so from the other side.
