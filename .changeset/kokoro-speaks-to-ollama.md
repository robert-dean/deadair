---
'@deadair/plugin-kokoro': patch
---

The Kokoro plugin now works with OpenAI-compatible speech servers that have no voice list, such as Ollama: Test connection and quarantine recovery ask `/models` instead of failing, Ollama's voices appear in the settings form, and a refused request says what the server objected to.
