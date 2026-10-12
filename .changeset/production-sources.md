---
'@deadair/api': minor
'@deadair/web': minor
'@deadair/sdk': minor
'@deadair/desktop': minor
---

A production can be handed sources to read: pasted text, each with a title. Given sources and no notes, the station reads them before writing anything and keeps as notes only the claims whose words it can find in them, so a podcast made from an article states nothing as fact that the article does not say. One whose sources give nothing usable fails with the reason rather than being written from general knowledge. Productions have a new state, `researching`, while their sources are being read; the console and the desktop app call it "reading its sources", and it can be stopped like any other stage. The console's production form has a Sources section. In the API, `ProductionRequest` and `Production` carry an optional `sources` list, and a source with no text is refused.
