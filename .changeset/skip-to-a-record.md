---
'@deadair/api': minor
'@deadair/web': minor
'@deadair/sdk': minor
---

The running order on the Desk can now skip straight to a record further down it. Each record still to come carries a **Skip to** button beside Play next: pressing it passes over everything in front of that record, including anything the player had already been handed and the breaks between, cuts what is on air, and plays the record next. The records passed over show as skipped, and a break that was being written for one of them is written off. Only a record can be skipped to, not a break, since a break's words are about the records around it. With nothing on air, the order moves and the station starts from that record when it next airs. The new route is `POST /director/air/items/{itemId}/skip-to`, `skipToARunningOrderItem` in the SDK.
