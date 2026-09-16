---
'@deadair/api': patch
---

The artwork the mount broadcasts is now only ever the station's own. A provider's cover URL is never put on the wire: a player will not fetch one, since it ends in an id rather than in a picture's name, and the field reaches every listener, so a Subsonic cover link would have handed the operator's own credentials to anybody who connected. A record whose cover the station has cached carries it, and anything else carries the station's logo.
