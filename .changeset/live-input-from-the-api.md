---
'@deadair/api': patch
'@deadair/sdk': patch
---

The live input can be armed and disarmed through the API (`POST /playout/live/arm`, `POST /playout/live/disarm`), and `GET /playout/status` reports what it is doing, including the countdown before a presenter takes the air. `GET /playout/live/connection` gives an operator the port, mount, user and password to put into their encoder. The activity feed records each time the input is armed, goes on the air and comes off it. While a presenter is live, the station counts as on the air and the audio chain is not restarted over records nobody can hear. The station's own programme still carries on underneath for now, so its history records those records.
