---
'@deadair/plugin-kokoro': patch
'@deadair/plugin-chatterbox': patch
'@deadair/plugin-analyzer': patch
'@deadair/api': patch
---

Pressing Test connection on a server that is not running no longer switches the plugin off. The
three plugins that talk to something the operator runs themselves — both speech engines and the
analyzer — reported an unreachable server by failing the call rather than by answering it, and the
host counts a failed call towards the breaker: three presses quarantined the plugin, which for a
speech engine is the station left with no voice and for the analyzer is a station that stops
measuring, in both cases because somebody pressed the button that asks whether the server is there.
They answer now, the address is in the answer, and none of it counts against the plugin.

A failure on the wire also says what it was. `fetch` reports every one of them as "fetch failed" and
hides the reason a level down, so "connection refused" — nothing is listening on that port — read
exactly like a name that does not resolve and like a server answering on the wrong protocol. The
reason and its code are now in the message, wherever a plugin's last error or a record's audio
failure is shown.
