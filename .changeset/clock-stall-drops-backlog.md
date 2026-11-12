---
'@deadair/api': patch
---

A listener no longer ends up far behind the Desk after the audio chain stalls. When something held Liquidsoap's streaming loop, it used to produce everything it had missed (up to a minute of it) as one burst afterwards, and every player that received the burst stayed that far behind for the rest of the session, hearing the previous record while the Desk named the next. A stall longer than eight seconds is now dropped instead: it is heard once as a gap and the stream comes back in step. `CLOCK_MAX_LATENCY_S` moves the threshold.
