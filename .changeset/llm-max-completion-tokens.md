---
'@deadair/plugin-llm': patch
---

OpenAI's newer models no longer fail every capped call with "Unsupported parameter: 'max_tokens'". When a model refuses `max_tokens` and asks for `max_completion_tokens`, the request is sent again under the new name, and that model's later calls use it from the start. Local servers that only know `max_tokens` are sent exactly what they were before.
