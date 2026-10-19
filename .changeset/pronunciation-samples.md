---
'@deadair/api': minor
'@deadair/web': minor
---

Voice, Pronunciations: every entry has a play button that speaks the word the way that entry says it, so a respelling can be judged before it airs. It works for proposals and turned-down entries as well as active ones, and beside the Written and Said fields for one still being typed or edited. Pick the voice to hear them in at the top of the page, or leave it on the plugin's default. The route is `POST /pronunciations/sample` with the written form, the spoken form and an optional voice; it is in every SDK.
