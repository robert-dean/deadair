---
'@deadair/api': patch
---

The station can post each record to a chat as it goes to air. In the Telegram plugin, list a channel's @name or a group's id under Chats to announce in, and every record is announced there with its artist and album. An announcement that cannot be delivered is retried for as long as the record is still playing and dropped after that, so a chat never reads "now playing" about something that has already finished.
