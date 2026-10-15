---
'@deadair/api': minor
'@deadair/web': minor
---

Each job a model does (talk breaks, choosing records, reading articles, judging moods, saying what a record is about, the two persona passes, writing a character, and now productions) names a list of models, tried in order, rather than one. If a model fails before it answers, because its server is down, it answers an error, it times out or it has been retired, the station asks the next one on the list straight away, and asks the failed one last for the next minute so a dead server is not tried on every call. Settings → Words shows each list as a list box: add from every model your providers offer, move a model up or down, or remove it. Every model you had set becomes a list of one, and an empty list still means the plugin's default.
