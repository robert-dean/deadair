---
'@deadair/api': patch
'@deadair/plugin-sdk': patch
---

Two new settings for the model that writes the talk breaks: how hard it thinks before it speaks, and how much room it has. Some models think at length even when asked to think a little, and run out of room before they say anything, so the break falls back to the station's own phrasings. Setting the break model to not think at all fixes that for those models. Nothing changes until you set them.
