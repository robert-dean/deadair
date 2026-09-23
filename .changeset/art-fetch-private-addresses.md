---
'@deadair/api': patch
---

The station no longer fetches cover and artist art from private addresses it was never told about. An art URL is whatever an upstream said (Last.fm, Deezer, Wikipedia, Cover Art Archive, Spotify, a Navidrome's artist info), and one pointing at `127.0.0.1`, a cloud metadata address or anything else on the station's own network was fetched and, if it answered with an image, served publicly. Every hop is now resolved before it is connected to and refused if it reaches a private address, and redirects are followed by hand so a public host cannot bounce the fetch onto a private one. The servers you pointed a plugin at are still trusted, by host and port, so a Navidrome on your LAN keeps its cover art.
