---
'@deadair/api': minor
'@deadair/sdk': minor
'@deadair/web': patch
---

A band on the format clock at a time of day can be marked hard (`hard` on a clock band, migration 0138). Nothing acts on it yet: a hard band still airs at the first boundary after its time, as every band does. A save that leaves `hard` out keeps what is stored, so a console that predates it cannot make a band soft by moving it.
