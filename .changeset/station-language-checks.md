---
'@deadair/api': patch
---

On a station set to a language other than English, the checks on what the presenter wrote no longer refuse good breaks for not being in English. A record named in the German genitive, a persona's word with a German or Spanish ending or a French article in front of it, a date written `24.` and a temperature written `17,5` are all read correctly. The checks that only understand English words (cueing a record on the wrong side, naming the wrong part of the day, a programme introducing itself twice) are switched off. Where the station can't tell whether a break mentioned the time or the weather, it assumes it did, so a late break is replaced rather than going out with a stale time or reading.
