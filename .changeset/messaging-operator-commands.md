---
'@deadair/api': patch
'@deadair/web': patch
'@deadair/sdk': patch
---

A station operator can link their Telegram account and run the station from a chat. Under Settings, Sign-in and security, Chat accounts, ask for a code and send `/link CODE` to the station's bot in a direct message; that chat account can then send `/skip`, `/offair` and `/onair`, with exactly the permissions your station account has, checked again on every command. Unlink from the same card, or send `/unlink`. A code lasts ten minutes, works once, and stops working the moment it is sent to a group.
