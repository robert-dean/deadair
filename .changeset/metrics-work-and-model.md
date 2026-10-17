---
'@deadair/api': minor
---

The station's numbers now include its work and its model: how long each job queue, plugin call and model call took, how many tokens each kind of decision asked the model for, how many of them failed, and, as they change over the day, the library's size, cached and measured counts, the model's queue and the media on disk. They are read off the timings the station already kept, so nothing is measured twice.
