---
'@deadair/api': patch
'@deadair/web': patch
---

Callers stop being offered as hosts, and a broadcast refuses one. `GET /personas` answers with the whole roster, hosts and callers together, because the personas page draws both — so narrowing it is each surface's own job, and three of them had never done it: the on-air "Presented by" menu, "Hosted by" on a slot or a briefing box, and a production's presenter. Picking a caller there was not cosmetic. `DirectorConsoleService.recast` checked only that the persona existed, so the caller presented the show and `SegmentRepository.recast` rewrote every break in the tail in the character of somebody whose whole premise is that they are phoning in. `recast` now refuses a caller with the sentence `PersonasService.setDefaultHost` already used, and every console surface that offers a host narrows through one `presents` predicate rather than four copies of `kind !== 'caller'`. `putOnAir` still takes a persona id on trust, deliberately and for its own reason, so the endpoint half of that path is unchanged.
