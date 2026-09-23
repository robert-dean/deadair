---
'@deadair/plugin-sdk': minor
'@deadair/plugin-kokoro': patch
'@deadair/plugin-chatterbox': patch
'@deadair/plugin-rhapsode': patch
---

The check every speech plugin puts on the end of its engine's body now lives in the SDK. `plausibleAudio` passes the audio through and fails it as an `upstream` error when it ends under `MIN_PLAUSIBLE_AUDIO_BYTES`, which is what a server answering 200 with a short JSON complaint looks like. Kokoro, Chatterbox and Rhapsode each carried their own copy and now use it, with the same messages as before; a new speech plugin pipes its body through it rather than writing a fourth.
