---
'@deadair/api': patch
'@deadair/plugin-sdk': patch
'@deadair/plugin-llm': patch
'@deadair/plugin-apple-music': patch
---

A secret saved with a control character in it no longer breaks every call that sends it, and Test connection and the plugin log no longer quote a stored key a request header refused. Secrets whose line breaks matter declare `multiline` and keep them.
