---
'@deadair/api': minor
'@deadair/sdk': minor
'@deadair/web': minor
---

After an import, the station looks up the records its library was missing and adds the ones a connected source has. It asks the source a record was copied from, when that source is connected, and otherwise searches every source by title and artist, using the same strict match it uses to find records it chooses to play. A playlist's page has a "Look up missing records" button to try again, and the activity feed reports how many records each look-up found. Nothing is looked up while `rotation.discover` is off.
