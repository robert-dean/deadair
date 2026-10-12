---
'@deadair/api': minor
'@deadair/web': minor
'@deadair/sdk': minor
---

The station can make shows of its own. Library, Podcasts has a Your shows section above the shows the station carries: a show is a saved recipe (what it is called, who presents it, how long an episode runs, and what an episode is about when nobody gives it a topic), with Wind-down and News in depth offered as starting points. Make an episode takes an optional topic, something to read first and a time to air, and the episode is made and aired like any other production, appearing under its show with how far along it is. In the API, `/podcasts/own` lists, creates, updates and deletes the shows, `/podcasts/own/{id}/episodes` lists a show's episodes and asks it for one, and `Production` carries the `showId` of the show it belongs to.
