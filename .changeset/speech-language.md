---
'@deadair/plugin-sdk': patch
'@deadair/plugin-rhapsode': patch
'@deadair/api': patch
---

Speech requests carry the station's language as `SpeechRequest.language` whenever it isn't English, and a speech plugin can say which languages its engine speaks with the new optional `listLanguages()`. When your voice engine lists its languages and the station's language isn't among them, the station logs a warning once. It still speaks the line. The Rhapsode plugin sends the language to builds that list it and reports what every voice in use can speak.
