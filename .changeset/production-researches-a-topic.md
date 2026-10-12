---
'@deadair/api': minor
'@deadair/web': minor
'@deadair/sdk': minor
'@deadair/plugin-sdk': minor
'@deadair/plugin-websearch': minor
---

A production can research its own subject. Tick Research it on your trusted sites when asking for one with nothing to read, or set one of your own shows to research every episode, and the station searches the sites you trust in the web search plugin, reads what it finds there and states only that. It never reads a site you have not trusted, and when none of them has anything the production fails with that reason rather than being written from general knowledge. For plugin authors, an `enrichment` plugin may implement the optional `enrichTopic({ query })`, answering with `documents` as `enrichArtist` does.
