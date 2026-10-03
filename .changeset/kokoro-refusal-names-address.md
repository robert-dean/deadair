---
'@deadair/plugin-kokoro': patch
---

When the speech server refuses a request, the error now names the address it was sent to, and where a redirect took it if there was one. Before, it named only the voice, which is rarely the problem: an `HTTP 405` usually means the Server URL points at the engine's web page, or at an address that redirects and turns the request into a GET.
