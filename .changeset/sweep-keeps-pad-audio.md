---
'@deadair/api': patch
---

The nightly **Delete media files nothing points at** housekeeping job (off by default) no longer deletes the soundboard's sounds. It used to treat every pad as unused, so a station running a day or more past its last restart could lose its pads, and breaks that hit one aired their words alone. If you have that job switched on, press **Re-scan the library** on the Pads page, or restart the station, to bring back any pad it removed.
