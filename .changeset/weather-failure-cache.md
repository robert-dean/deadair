---
'@deadair/plugin-weather': patch
---

The weather plugin no longer asks a failing service again on every call. After a refusal or an error it leaves that question alone for a minute, or for as long as the service's `Retry-After` asks (at most fifteen minutes), and answers nothing meanwhile rather than a stale reading; the first failure is still reported. A place nothing could find is remembered for an hour, and callers asking the same thing at once share one request. A connection test always asks, and any answer from the service ends the wait for everything else.
