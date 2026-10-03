---
'@deadair/plugin-sdk': minor
'@deadair/api': minor
'@deadair/sdk': minor
'@deadair/web': minor
---

Plugins can look for devices on the station's network (`host.discover`, by mDNS or SSDP) without binding any multicast port themselves, and reach what they find. When the station has never found anything that way, which on Docker usually means a bridge network, the desk's speaker menu says so once.
