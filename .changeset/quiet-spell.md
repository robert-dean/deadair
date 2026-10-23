---
'@deadair/api': minor
'@deadair/sdk': minor
'@deadair/web': minor
---

The station can be kept quiet for a while. On the desk, **Keep it from talking for** the next 3 records, the next 10 or the rest of the order takes the planned breaks out and plants none until that many records have started, then the station talks again by itself. It survives a refill, a new show and a restart, and **Talk again** ends it early. A scheduled programme still airs and a requested break is refused with the reason. Switching breaks off under Settings, Rotation now takes the breaks already planned out of the running order too, instead of leaving them to air. On the API: `PUT` and `DELETE /director/air/quiet`, and `quietRecords` on the station's air.
