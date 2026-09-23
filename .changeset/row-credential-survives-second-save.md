---
'@deadair/web': patch
---

An API key typed into a provider row of the Language model plugin (or any other table with a key in it) is no longer lost the second time the form is saved. The first save stored it. The next save, made without reloading the page, sent the row as if it were new, so the stored key was dropped and the save was refused with "Anthropic and Gemini need an API key". A row now keeps the same identity from the moment it is added, so its key stays attached across saves. A station already caught by this only needs the key typed in once more. (#242)
