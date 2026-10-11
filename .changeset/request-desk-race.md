---
'@deadair/api': patch
---

Two requests that arrive together (a double tap in the app, or the app and a linked chat at once) no longer both get through. The database now holds one open request per person and one per record, and the second of two overlapping requests is answered as declined with the same reason it would have had if it had arrived a moment later. Any duplicate open requests already present are let go when the station updates, keeping the oldest.

A listener asking for a record from a music provider is now refused before that record is taken into the library when they would be refused anyway (requests off, off the air, a request already in, the cooldown, or the line full), so a refusal no longer adds a record to the library. That refusal is answered as declined with its reason as before, but it is not kept, so it does not appear in the listener's own list afterwards.
