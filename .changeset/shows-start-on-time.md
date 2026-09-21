---
'@deadair/api': minor
'@deadair/web': minor
---

Scheduled shows can now start on time. **Schedule > Timetable > At a boundary > Start shows on time**,
which is **off** until you turn it on.

When a block on the schedule starts, the record already playing is left to finish, and that has not
changed. What was missing was a limit: a seventeen-minute record playing at the top of the hour meant
the new show started at seventeen minutes past. Turn this on and a record from the programme that
just ended that is still playing a set number of minutes into the new block (five unless you change
it) is cut, the same way the Skip button cuts, so the show starts close to when the timetable says.
Most records end well inside five minutes, so it is only ever the long ones.

Only the schedule's own changeovers are affected. A programme you put on by hand always lets the
record finish, and so does a changeover that happens late in a block (when a hold runs out, say):
the record is never counted as overrunning for longer than it has actually been playing. Each cut is
written to the activity feed, naming the record and the show it was holding up.
