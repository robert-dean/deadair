---
'@deadair/plugin-sdk': minor
'@deadair/api': minor
---

A speech plugin can now say how much text its engine takes in one go, and the station knows how to cut something longer than that into as few calls as will fit. It cuts at the strongest boundary available, between paragraphs first, then between sentences, then between words, because a cut mid-sentence is audible where a slightly longer call is not. Nothing a presenter says is anywhere near any engine's limit, so no break changes; this is groundwork for reading something long out loud.
