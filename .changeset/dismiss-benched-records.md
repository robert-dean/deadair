---
'@deadair/api': minor
'@deadair/web': minor
---

The "records have no copy left that will play" row on the desk and Check-up can now be dismissed. Some of those records can never come back (their provider refused them), so the row used to stay there for good. Dismiss accepts the records benched at that moment. The row comes back on its own if another record loses its last copy, or if one you dismissed recovers and then loses its copies again. Dismissed records stay benched and the catalog's Benched filter still lists them; the row says how many it is leaving out. Dismissing needs an admin.
