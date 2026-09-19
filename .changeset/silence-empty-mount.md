---
'@deadair/api': patch
---

The station now says so when Icecast has no source on its mount. Liquidsoap could be running and
answering while Icecast answered 404 to every listener, and "Why it is quiet" reported that as
waiting for a listener, who could never arrive. It is now "the stream is not reachable", with a
sentence saying Icecast has no source and a remedy: restart Liquidsoap so it connects again. For the
first thirty seconds it is a wait rather than a fault, since a restarted Liquidsoap reconnects on
its own.
