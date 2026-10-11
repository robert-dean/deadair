---
'@deadair/plugin-sdk': minor
---

A `secret` config field, or a `secret` column of a `list`, can name the address it is sent to with `sentTo`. The manifest schema refuses a `sentTo` that names no `url` or `string` field (or column) in the same form, and `sentToProblems` answers the same question for any form.
