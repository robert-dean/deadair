---
'@deadair/api': patch
---

A bulletin with a feed list asks four feeds at a time, working down from the top of the list, and stops asking once it has the stories it needs. It used to ask every listed feed at once. With a long list, bulletins could come back with nothing because the requests were queued behind each other, even though every feed was answering. The stories chosen are the same as before.
