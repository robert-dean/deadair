---
'@deadair/api': minor
'@deadair/sdk': minor
'@deadair/web': minor
---

Mail: Settings → Mail shows the invitation email as the station would send it now, under the form. It uses a sample link, sender and date, and has a switch between the listener and admin versions. The email is drawn in a sandboxed frame with a tab for its plain text, and saving new wording updates it. If the saved wording cannot be used, it says why instead of only writing a line to the log. Behind it is a new route, `GET /settings/mail/invitation/preview`, which needs `platform.manage`.
