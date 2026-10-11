---
'@deadair/web': patch
'@deadair/api': patch
---

The history page no longer tells an operator to turn on `llm.captureWrites` when a prompt was not kept. It names the setting the way the console shows it, "Keep the prompt and the raw answer", and links to the Words page in Settings where it lives. Two station errors that told an operator to set `stream.publicUrl` or `stream.speakerUrl` now name "Public URL" and "Address for speakers" under Stream in Settings.
