---
'@deadair/api': patch
---

A console served from a different address than the API is no longer refused on every call when `SPA_BASE_URL` or `APP_BASE_URL` is written with a trailing slash or a path. The station now compares the browser's origin against each address's origin rather than the address as written.
