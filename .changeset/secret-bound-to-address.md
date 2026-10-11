---
'@deadair/api': patch
'@deadair/plugin-llm': patch
'@deadair/plugin-jellyfin': patch
'@deadair/plugin-plex': patch
'@deadair/plugin-navidrome': patch
'@deadair/plugin-kokoro': patch
'@deadair/plugin-chatterbox': patch
'@deadair/plugin-emby': patch
---

A stored key, token or password is no longer kept when the address it is sent to moves to another server. Saving a new server address for Jellyfin, Emby, Plex, Navidrome, Kokoro, Chatterbox or a model provider without typing its key again is refused, with "Enter it again: the address it is sent to changed." under the key, so nobody allowed to edit a plugin's settings can point it at their own server and collect a credential the console never shows them. The same holds for the mail password when the SMTP server changes, and for a sign-in provider's client secret when its issuer moves. A change to the path on the same server (a `/v1` to a `/v2`, a Keycloak realm) keeps the key as before. A plugin's secret submitted as an empty string is now treated as cleared by the settings check too, which is what the save already did.
