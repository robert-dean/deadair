---
'@deadair/api': patch
---

Listeners can ask for a record from Telegram with `/request` followed by a title, an artist or both. A single clear match is asked for straight away; otherwise the bot offers up to three matches as buttons. The bot says whether the request went in, is waiting, or was turned down and why, and tells them again when it goes in after a wait, when an operator decides on it, and when it plays. A linked chat account shares its station account's request limits.
