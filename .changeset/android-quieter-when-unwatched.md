---
'@deadair/android': patch
---

A stream the app has given up on now stops, instead of sitting there looking like it is still
playing. It has always stopped trying to reconnect after five minutes, so a phone left on a station
that went away does not flatten its battery against it — but it went on holding the notification
with its Stop button, and went on asking the station what was on every three seconds, for a stream
that had already been abandoned. The worst case was a station whose stream had dropped while the
rest of it answered normally: the retries ended and the asking never did. Now it stops properly, and
Play starts it again.

Listening with the screen off costs less. While something is actually showing what is on — the app
in front of you, or the lock screen with the display lit — nothing has changed: the station is asked
every three seconds, as before. With the display dark, when nobody can see the answer, it drops to
every thirty seconds. What keeps the lock screen right in between is the record itself: the title
carried in the audio arrives exactly when the record changes, and the app asks the station then
rather than on a clock, so the lock screen is if anything more accurate than it was. Measured on a
phone over twenty minutes of listening with the screen off, this is about 18% less processor time
and a tenth of the requests. It is not a dramatic saving and it is worth being plain about that:
the audio stream itself is the great majority of what listening costs, and none of this changes it.

Now playing also stops animating the progress bar once it has faded away to show the cover.
