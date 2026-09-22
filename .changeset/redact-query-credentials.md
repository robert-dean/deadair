---
'@deadair/plugin-sdk': patch
---

When a service answers with something that is not JSON, the error in the station log no longer includes the API key from the request URL. Keys sent in the query string (Last.fm's `api_key`, for example) now show as `REDACTED`, and the rest of the URL is kept so you can still tell which call failed.
