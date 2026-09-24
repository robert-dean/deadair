---
'@deadair/plugin-sdk': patch
'@deadair/plugin-telegram': patch
---

Messaging plugins can put buttons under a message, and a press comes back to the station as an action carrying the button's id and value. The Telegram plugin sends them as an inline keyboard and acknowledges every press so the button stops spinning.
