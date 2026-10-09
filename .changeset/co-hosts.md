---
'@deadair/api': minor
---

A schedule slot can have co-hosts who present beside its host (`coHosts`): every night, on fixed nights, or as a visitor who turns up at random (`everyN`, with `cooldownDays` between visits), like a guest host. Up to three are on air on any one night. The running order and `GET /schedule/current` say who is co-presenting tonight, and a visiting co-host's night begins at the top of the show. On a show with co-hosts, talk breaks go round them: each one is written and spoken by whichever presenter was heard least recently, and every break knows who else is presenting tonight. A **banter** is a new kind of production for a show with co-hosts: the presenters trade lines for a few minutes, the lead bringing the others in and handing back to the music at the end. Put a `banter` band on the format clock to have a few a show; one asked for on a show with nobody beside the host fails with a reason.
