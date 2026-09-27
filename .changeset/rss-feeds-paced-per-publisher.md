---
'@deadair/plugin-rss': patch
---

Pace RSS feeds per publisher rather than as one queue. Every feed and story page shared one bucket at one request a second, so a long feed list could not be read inside a single eight-second call: the connection test reported most feeds as unreachable and bulletins timed out on feeds that were answering fine. Each publisher is now paced on its own, and story pages have a bucket of their own.
