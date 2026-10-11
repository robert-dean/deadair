---
'@deadair/api': patch
---

When a show's brief names artists, the model choosing its records is now given those artists in the order the station has neglected them, with how long ago each last played, and told to search for them in that order. Before, it worked down the brief from the top and often ran out of time before reaching the artists at the end, so a few acts at the start of the list took most of the show.
