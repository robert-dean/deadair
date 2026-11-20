---
'@deadair/plugin-sdk': patch
---

An analyzer plugin can now report a record's `brightnessHz` (`TrackTimbre`), the median spectral centroid of its sounding audio. The station ranks it with the loudness as the record's energy; an analyzer that does not report it leaves that energy resting on loudness alone.
