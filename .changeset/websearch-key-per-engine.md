---
'@deadair/api': patch
'@deadair/plugin-websearch': patch
---

**Web search keeps a key per engine.** Brave and Tavily shared one stored API key, so saving the form with only the engine changed sent one company's key to the other. Each engine now has its own box and is only ever sent its own key. Choosing a keyed engine with no key of its own is refused on save, and switching away and back needs nothing retyped. An existing key moves to the engine the station is on when it updates. A key left over on a station running SearXNG is deleted, because nothing says whose it is, so enter it again if you go back to a keyed engine.
