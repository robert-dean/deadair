---
'@deadair/api': patch
'@deadair/sdk': patch
---

A listener's request search now asks the music providers on every search, not only when the library has fewer than three matches. Searching an artist you hold a few records by now also offers the rest of what the providers carry, after your own records and up to the page size. Still only while "Discover new music" (`rotation.discover`) is on, and each term's provider answer is still reused for a minute.

The server now limits how often a request search can reach the providers, whatever is calling it (an app, the API directly, or MCP): twenty fresh provider searches a minute per account, and a hundred and twenty a minute for the whole station. Concurrent searches for the same term share one provider call. Past either limit the search answers with your library alone instead of failing, so a script hammering the endpoint cannot get your providers rate-limited or quarantined.
