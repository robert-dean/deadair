---
'@deadair/api': minor
---

Choose which similarity source the station asks first

With more than one similarity plugin enabled, two of the three questions the
station asks them take the first usable answer and stop: what to play by an
artist, and what sounds like a particular record. Which source answered was
decided by alphabetical order of the plugin id, which is not a decision anybody
made, and an operator who trusted one source over another had no way to say so
short of switching the others off.

**Which similarity source to ask first**, under Settings, Rotation, is that
list. Leave it empty and nothing changes. Listing a source does not enable it
and leaving one out does not disable it: anything unlisted is simply asked
after the ones that are.

Who resembles an artist is unaffected, because that question is asked of every
source and the answers pooled. Two sources disagreeing about who sounds like
Portishead are not in conflict.
