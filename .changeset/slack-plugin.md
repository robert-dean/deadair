---
'@deadair/plugin-slack': patch
'@deadair/api': patch
---

A bundled Slack plugin puts the station in a Slack workspace. Make an app from the manifest on the plugins page of the docs, paste its bot token and app-level token, and people can use the station's slash commands in a direct message or in the channels you list, and press a button to pick when a request matches more than one record. It can post each record to a channel as it goes to air. It needs no public address: the station holds a Socket Mode connection open to Slack.
