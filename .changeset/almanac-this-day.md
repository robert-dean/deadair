---
'@deadair/plugin-sdk': minor
'@deadair/plugin-wikipedia': minor
'@deadair/api': minor
'@deadair/web': minor
---

This day in history, as a kind of break the station can be given

The station already reads the news and gives the weather. This is the third
thing a presenter does between records: something that happened on today's date
in another year. Put a **This day** band on the format clock and it airs; the
presenter can also reach for the date mid-conversation, the way it reaches for
the weather.

There is nothing new to sign up for. The bundled Wikipedia plugin answers it,
out of the same encyclopaedia the station already draws its facts from, so an
install that has given it a contact address has this already.

**A day is mostly general history, and this is a music station**, so
"What the station picks out of the day" under Settings, Rotation decides what to
do about that. The default puts the musicians first and keeps everything else
behind them, which means a thin day still has something to say; "Music only" is
the stricter reading and will skip the slot rather than reach for a treaty.

What the station says is what its source published. The break frames one entry
with the year and whether it is a birth, a death, an event or a day that comes
round every year, and adds nothing at all — and where a model writes it instead,
a year the station was never given is refused outright, exactly as an invented
temperature is on the weather. Nothing is read out twice in one day, and the
date is the one the break AIRS on, in your own timezone, so a break written at
ten to midnight is about tomorrow.

**A presenter can also mention the date on an ordinary link**, on the terms the weather already set:
"Let the presenter mention the date between records", off by default, offers the day to the
presenter to use or ignore. Most links ignore it, and the ones that do not mention an anniversary in
passing rather than reading a list out. Anything said that way is spent, so a band on the clock set
to This day has one fewer entry to use — a station that wants both is dividing one day between them.

For plugin authors: `almanac` is a new capability, a month and a day in and
entries out. The host decides which day it is, and your entries are read
verbatim, so pass the source's own sentence and its descriptions along rather
than composing anything.
