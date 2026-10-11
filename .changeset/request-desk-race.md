---
'@deadair/api': patch
---

Two requests that arrive together (a double tap in the app, or the app and a linked chat at once) no longer both get through. The database now holds one open request per person and one per record, and the second of two overlapping requests is answered as declined with the same reason it would have had if it had arrived a moment later. Any duplicate open requests already present are let go when the station updates, keeping the oldest.
