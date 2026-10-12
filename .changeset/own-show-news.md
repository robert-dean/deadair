---
'@deadair/api': minor
'@deadair/web': minor
'@deadair/sdk': minor
---

One of the station's own shows can read the news. Choose the feeds it reads and how many hours back, and each episode is made from the newest stories on them, stating only what it can find in them; a story you keep off the air is kept out of the episode too. The News in depth starting point reads every feed the station has over the last day until you narrow it. Asking for an episode when the feeds had nothing in the window says so rather than queueing one. In the API, `OwnShow` carries `newsFeedIds` and `newsHours`.
