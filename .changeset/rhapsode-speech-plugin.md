---
'@deadair/plugin-rhapsode': minor
'@deadair/api': minor
---

A third voice: the station can speak through a [Rhapsode](https://github.com/MaroonedSoftware/rhapsode)
server, which holds several speech engines at once and publishes what each of them can do.

**A voice belongs to an engine**, so the Voices table names both: one station can read its news in
one engine's voice and its breaks in another's. Rows that leave the engine column empty take the
default engine, which is the whole setup for a station running one. The engines this server has, the
voices each of them holds — including any you have cloned in yourself — and the builds it can load
are all offered in the form once it can be reached.

**It asks the server what an engine can do rather than assuming.** Which performance cues a voice can
perform, whether it can be asked for a hushed or frantic reading, and how much text it takes in one
call are read from the server per engine, so a writer is offered what this station can actually
deliver. It also reads which audio formats the server can encode: a Rhapsode built without ffmpeg
offers wav alone, and the station asks for wav rather than losing the break.

**Residency stays with the server.** There is no unload switch and no idle timer here, because
Rhapsode queues, evicts and reloads models itself. The one setting is how long to keep a model loaded
after a break — leave it empty to use the server's own.
