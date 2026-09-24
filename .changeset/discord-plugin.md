---
'@deadair/plugin-discord': patch
'@deadair/api': patch
---

A bundled Discord plugin puts the station on Discord. Give it a bot token with the Message Content intent turned on and people can use the station's slash commands, or type them, in a direct message or in the channels you list, and press a button to pick when a request matches more than one record. It can post each record to a channel as it goes to air. The first time somebody in an unlisted channel speaks, the channel's id is written to the plugin's log so you can find it. It needs no public address: the station holds a connection open to Discord rather than waiting to be called.
