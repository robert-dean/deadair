---
'@deadair/api': patch
'@deadair/plugin-kokoro': patch
'@deadair/plugin-navidrome': patch
---

The MP3 mount now defaults to 320 kbps rather than 128. A station that never chose a bitrate moves to 320 on upgrade, which is about two and a half times the bandwidth per listener; set Stream, Bitrate back to 128 to keep the old figure. Kokoro now asks for FLAC rather than MP3 by default, so a break reaches the stream with one lossy encode instead of two; a Kokoro whose format was saved keeps it. Navidrome's stream format help now says that the original file is the only lossless path, rather than describing the choice as one of CPU.
