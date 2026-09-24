---
'@deadair/plugin-telegram': patch
'@deadair/api': patch
---

A bundled Telegram plugin puts the station on Telegram. Give it a bot token from @BotFather and anybody who messages the bot can ask it what is on air; list a group's id and it answers there too, and the first time somebody in an unlisted group speaks to the bot, the group's id is written to the plugin's log so you can find it. It needs no public address, since the station asks Telegram for messages rather than waiting to be called.
