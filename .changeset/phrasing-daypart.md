---
'@deadair/api': minor
'@deadair/web': patch
---

Phrasings can name the part of the day with `{{clock.daypart}}` ("this morning", "this afternoon", "this evening", "tonight"). Unlike `{{clock.rough}}`, which needs `clock.namesTheTime` switched on, it is filled on every break that knows when it airs, in the talk, news, weather, date, welcome, changeover and warm-up phrasings. A break that says it is claimed only until that part of the day ends, so one that slides past noon is rewritten rather than aired. The persona editor no longer flags it as unknown. A date break whose phrasing also said the time is now claimed only as long as that time holds, rather than all day.
