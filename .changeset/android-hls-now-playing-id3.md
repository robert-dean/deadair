---
"@deadair/android": patch
---

On HLS the record on screen now changes when the new record is heard, not several seconds before. The app reads the titles the station stamps into each HLS segment, as it already did with the MP3 stream's, and only falls back to timing the change off its own buffer when a stream names nothing.
