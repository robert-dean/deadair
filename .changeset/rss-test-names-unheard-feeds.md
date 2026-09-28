---
'@deadair/plugin-rss': patch
---

The RSS connection test reads several feeds at once and stops starting new ones when its time runs short. A feed it had no time for is named as "ran out of time before hearing from" instead of being listed as a feed that returned nothing. If the feeds use up the whole test, it says the stories were not checked, instead of telling you to allow a permission you may already have allowed.
