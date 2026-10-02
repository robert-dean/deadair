---
'@deadair/api': minor
'@deadair/plugin-sdk': minor
'@deadair/plugin-analyzer': minor
'@deadair/desktop': patch
---

A new plugin capability, `transcode`, makes a small copy of a piece of audio for somebody to send on rather than for the station to air. The bundled audio analyzer answers it through a new `/transcode` endpoint on the analysis sidecar, which encodes with ffmpeg's own AAC encoder (mono at 64 kbps by default, so a minute of speech is about half a megabyte). It has its own provider choice, "Make copies to share with" (`render.transcodePluginId`), so a station can join audio with one plugin and make copies with another; leave it empty and the first plugin that can is used, as for every other provider. Nothing asks for a copy yet. The console and the desktop app name the new capability on plugin cards and in Providers.
