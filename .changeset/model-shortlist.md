---
'@deadair/api': minor
---

A briefed show whose brief names its artists is now programmed from a list. The station gathers records by those artists and a few who sound like them, from your library and from what your music services have said, takes out anything that played too recently, any artist who just played and anything you dislike, and hands the model a numbered list. The model answers with numbers instead of searching and writing out titles, so a refill takes seconds rather than minutes and every record it picks can play. If the model says nothing, the hour is drawn from the same list. It can still search for something the list lacks, such as a song the brief names by title, and a brief that names no artists is programmed exactly as before. "Choose from a list when the brief names its artists" in the model settings turns it off.

The station also finds artists your brief names that your library has never held (black metal acts on a brief that lists them, say) by looking among the artists similar to the ones it does hold, and it now remembers what your similarity sources said about each artist for a week, so it asks them far less often, including after a restart.
