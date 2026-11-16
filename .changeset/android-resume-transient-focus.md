---
"@deadair/android": patch
---

Playback no longer stops for good when another app briefly takes the sound, such as a notification, a voice note or a short video: it carries on by itself when that app is done, and after anything longer than a few seconds it comes back at what is on air now rather than where it left off. A sound that holds on for more than two minutes, such as a phone call, still stops it, and the playback log now says that was why.
