---
'@deadair/api': patch
---

Changing an event destination's address now needs a recent strong factor (an authenticator code or a passkey, when you have one), as adding a destination and giving it a new secret now do too. A destination keeps its secret when its address changes, so moving it would otherwise send every later event, still signed, wherever somebody pointed it. Connected apps can no longer change a destination over MCP at all. Renaming one, switching it off and changing what it is sent need nothing extra.
