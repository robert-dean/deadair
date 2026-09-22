---
'@deadair/api': patch
---

The audio chain's log is mostly useful lines again. Liquidsoap warned about a "possible source leak" and printed its whole list of sources, about 40 lines each time, whenever the station had more than 50 sources. The station normally runs with 50 to 52 and nothing is leaking, so the warning now waits until 100. Beyond that, the audio chain no longer uses two functions Liquidsoap has deprecated, so it will keep starting after a future Liquidsoap upgrade removes them.
