---
"@deadair/api": patch
---

Playout: when a provider refuses a record's audio because the account is busy (`unavailable` or `rate_limited`: a stream playing on another device, a spent quota, a plugin mid-reload), the station puts the fetch off and asks again later instead of counting it toward writing that copy off. Before, an hour of a shared account in use elsewhere could bench every record the station tried in that hour.
