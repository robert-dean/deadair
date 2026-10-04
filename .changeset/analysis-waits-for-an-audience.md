---
'@deadair/api': patch
---

The hourly loudness and cue measurement no longer downloads records from the music server while nobody is listening. It still measures every copy the station already holds, and fetches as before once the station is on air for somebody, including partway through a run. On a library kept on spinning disks, the hourly download was enough to keep the disks from ever spinning down.
