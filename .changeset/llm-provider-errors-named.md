---
'@deadair/plugin-llm': patch
---

A model provider refusing a generation now says why. A quota refusal, an overloaded model or a rejected key used to reach the log as "No output generated. Check the stream for errors."; it now names the provider, the HTTP status and the provider's own message, and is classified as rate limited, unavailable or an auth failure accordingly.
