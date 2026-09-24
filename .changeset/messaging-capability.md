---
'@deadair/plugin-sdk': patch
---

Plugins can declare a new `messaging` capability, for connecting the station to a chat platform such as Telegram, Slack or Discord. The station asks the plugin for new messages with a cursor it keeps itself, rather than the plugin pushing them, and sends plain-text replies and announcements through it. Nothing in the station uses it yet.
