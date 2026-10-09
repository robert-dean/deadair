---
'@deadair/api': minor
'@deadair/desktop': patch
---

A schedule slot can have guest hosts who sit in for its own host on some nights (`guestHosts`). A guest is on fixed nights (`days`), or at random: `everyN` is about one of the slot's nights in that many, and `cooldownDays` is the fewest days between two of their nights (half of `everyN` when unset, so an about-weekly guest never lands two nights running). The random nights are worked out from the date, so the console, the timetable and the station all agree on who is on a given night, and nothing re-rolls mid-show. A guest has to be a host. On a guest's night the station puts them on and remembers whose show it usually is. The guest's breaks know they are sitting in for the regular presenter, by name and on which show, so they can say so and never call the show theirs.

In the console, the slot editor has Guest hosts: who sits in, then either the nights they sit in or about how often at random, with the gap between visits. Today names tonight's guest as sitting in for the regular host. `GET /schedule/current` says who presents the block on now (`hostPersonaId`) and whose show it usually is (`regularPersonaId`). The desktop editor carries a slot's guest hosts through untouched.
