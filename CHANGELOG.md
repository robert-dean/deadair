# Changelog

Notable changes to deadair, newest first. Versions follow [semantic
versioning](https://semver.org). An entry is written from the changesets a version pull request
consumed, and a version exists once that pull request is merged and its build passes, which is when
it is tagged `v*` and published. The `deadair/deadair:latest` image follows `main` and is not a
release. The listener apps keep their own changelogs, in
[apps/android](apps/android/CHANGELOG.md) and [apps/desktop](apps/desktop/CHANGELOG.md).

## [Unreleased]

## [0.24.0] — 2026-09-21

- Scheduled shows can now start on time. **Schedule > Timetable > At a boundary > Start shows on time**,
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
- Measuring records no longer makes the stream fall behind.

  The analyzer that works out where each record starts and ends and how loud it is now runs at a
  lower priority than the audio chain. On a busy machine the two used to compete as equals, and while
  a batch of records was being measured the broadcast could fall seconds behind real time; once, by
  26 seconds. Measuring now waits for the stream instead of the other way round. Nothing changes on a
  machine with CPU to spare.
- A presenter no longer says the same thing twice in one show.

  The station already shows the model the last few things it said and asks it not to reuse them, and
  now it checks. A talk break or a welcome that repeats a long stretch of an earlier break word for
  word (the same anecdote told again, the same intro read out a second time, a line turned into a
  habit) is sent back once to be said differently, and the ordinary phrasings air if the second try
  repeats itself too.

  Only long stretches count. The time, the station's name and a record's title come round again all
  the time and are left alone. News, weather and This Day are left alone too: when they repeat
  themselves it is because the headline or the conditions are the same, and saying them differently
  would not change that.

  The reason shows up in the script history as "said again, word for word, a long stretch of something
  the station said a few breaks ago".

## [0.23.0] — 2026-09-21

- The station can now delete media files that nothing points at any more. **Settings > Housekeeping >
  Delete media files nothing points at**, which is **off** until you turn it on.

  Records, cover art and the audio of everything the station has said are kept in folders named after
  what the bytes hash to, with a row in the database pointing at each one. When a row goes without its
  file going — a crash between writing the bytes and writing the row, or something deleted through the
  API — the file is left behind, and nothing can ever reach it again, because everything that reads
  one of these files starts from a row holding the name to ask for. Storage on the settings page has
  counted those files for a while and deleted none of them. This is the half that deletes them.

  Nothing that still has a row is touched, however old it is, and a file two rows share — the same
  ident at three slots in an hour is one recording — is kept as long as either row wants it. The
  voice previews are never swept at all: they are named after the question they answer rather than by
  any row, so every one of them looks unclaimed and none of them is.

  **A file is left alone until it has sat unclaimed for a day**, which you can change and cannot set
  below an hour. That wait is the whole safety of it: a file being written right now has no row yet
  either, for the moment between the two, and at that instant it looks exactly like one whose row has
  gone. A day is far longer than anything the station does, since writing a break takes seconds.

  The sweep runs nightly at 05:17 and puts one line in the activity feed when it removes anything,
  under a new **Storage** filter. It will not run at all while the switch is off.
- Presenters can now tell a story across several breaks, and keep a running joke going.

  A story on a character's shelf can be an ordinary one-off, a story in PARTS that goes out a piece at
  a time and gets somewhere, or a running BIT with no end that the presenter keeps coming back to and
  building on. A story in parts only moves to its next piece once the last one has actually aired, and
  a presenter leaves a wait between returning to the same thing — you set how long on the Settings
  page, under the persona group.

  Every time a character carries one of its own stories into a break is now written down, along with
  what it actually said. That record is what a running joke is built on, and it is also the thing the
  new Memory panel shows: what this character has told, newest first, with a way to roll back to any
  moment. Rolling back undoes what the station worked out on its own — the tellings, and anything the
  nightly passes wrote — and never touches a story, a note or a part you typed yourself. There is a
  preview before anything happens, and "clear all of it" for a fresh start.

  With a way back in place, a character can also be left to develop unsupervised: the new
  "Whether they develop on their own" setting on each persona decides whether the nightly passes hold
  their ideas for you to approve, as they always have, or keep what they write. Every character ships
  holding them for you.

  The nightly pass also learns two new tricks where it is switched on. It can suggest the next part of
  a story you have already started, and it can notice a running thing you have been doing on air
  without having written it down — it only offers one when it can quote the line it spotted it in. And
  it summarises where each running joke has got to, so the presenter is reminded what the thing has
  become rather than handed its own last sentences to repeat.

  One older rough edge goes with this: a note distilled from a break you thumbed down is no longer
  used. A character can no longer be taught to repeat something you said you disliked.

## [0.22.0] — 2026-09-20

- This day in history, as a kind of break the station can be given

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
- One page for every job more than one plugin can do

  Installing a second plugin that speaks, writes, or says who sounds like whom
  raises a question the console never asked out loud: which one does the station
  actually use. The answer was spread across four settings sections, in the
  section that owned the FEATURE rather than the one that owned the question, as
  a text box holding a raw plugin id. Most capabilities had no answer at all.

  **Settings → Providers** is now that page. Each job the station can do more
  than one way is a block: who can do it, which one is doing it, and for the jobs
  where order matters, the order they are asked in — drawn as the plugins
  themselves, by name, in the order the station is really using, so moving one is
  one click rather than rebuilding the default from an empty table first. A job
  only one plugin can do says so instead of offering a choice that is not one.

  Three capabilities gained an order they did not have:

  - **The weather.** Services are asked in turn and the first reading wins, so
    this decides whose forecast is read out. It was alphabetical by plugin id.
  - **Charts.** Sets the order of the menu, and decides outright which service
    answers a chart asked for by style.
  - **What the station believes about a record.** Sources are merged field by
    field and the first non-empty answer wins, so this decides who is believed
    about a year or a label. Each plugin still declares how much to trust it,
    which is what orders anything you have not listed; the setting is how you
    overrule that with what you can see on your own library. It changes what is
    looked up next rather than what is already stored.

  In every case an empty setting is exactly what the station did before, and
  listing a plugin never enables it: anything unlisted is asked after the ones
  that are, and an id nothing answers to is ignored rather than fatal.

  Two things that were invisible are now said out loud. A plugin **named** for a
  job and not running means the station is doing that job with nothing at all,
  because naming one is an instruction and never falls back; the page says so in
  red, and so does the plugin's own page. And every plugin card now says where it
  stands — "asked 2nd of 3 for who sounds like whom", "in use for speaking" —
  linking to the block that decides it, so the choice is visible from where you
  are standing when you make it.

  Nothing stored moves: the existing keys keep their names, and Rotation, Voice
  and audio, Words and Measurement each keep a line pointing at where their
  setting went.

## [0.21.0] — 2026-09-20

- Let the presenter mention the weather between records

  The station could already give the weather: a band on the format clock asks for
  it, and what comes back is a report — the conditions, today's high, and back to
  the music. That break is written to be correct, so the rules on it forbid
  comparing, advising and saying how any of it feels, because a presenter who does
  those things to a measurement has editorialised it.

  What it could not do was mention the weather while talking about a record. "It's
  sunny today, get out there and tan while you listen to this one" is a presenter
  doing their job, and every rule the station had about the weather forbade it.

  Turn on "Let the presenter mention the weather between records" and the reading
  is offered on an ordinary link, to use or ignore. Most breaks ignore it, which
  the prompt asks for in as many words: a link that notices it is outside is worth
  more than one that reports the forecast, and a presenter who mentioned the sky
  every quarter of an hour would be a station with a tic. The ones that take it up
  react to it, say what to do with an afternoon like this, and tie it to whatever
  is playing.

  The figures stay exactly as unfabricable as they are in a weather break. A number
  the service did not measure is refused before the words reach air, in the same
  check the weather break uses, and the station never rounds or converts on the
  model's behalf. What changes between the two kinds is only what a presenter is
  allowed to DO with a reading, never what they are allowed to claim about one.

  Off by default, and an upgrade changes nothing until you switch it on. It needs
  a weather plugin, a model writing the breaks, and "Where the station is" set;
  the station's own phrasings underneath the model do not mention the weather, so a
  station running without a model sounds exactly as it did. A break that does
  report the sky expires with the reading behind it, as a weather break does, so a
  sunny afternoon cannot go out at dusk — and one that ignored the offer is not
  held to a claim it never made.

## [0.20.0] — 2026-09-20

- A Deezer similarity source, so discovery works without an API key

  The station already reaches past its own library: it programmes part of every
  hour from artists who resemble what has recently aired, mixes neighbours into a
  playlist on request, and fetches a record it does not own when something picks
  one. All of that needed a similarity plugin, and there was exactly one —
  Last.fm, which needs an API key you have to go and register for. Until you had,
  the settings said discovery was on and nothing came of it.

  Enable Deezer and it works. There is no account, no key and nothing to fill in:
  Deezer's catalogue answers who resembles an artist, and what to play by them, to
  anyone who asks.

  It sits alongside Last.fm rather than replacing it. Two sources disagreeing
  about who sounds like Portishead are not in conflict, so the station keeps every
  name both of them offer and has a wider pool to programme from than either gives
  on its own.

  One thing worth knowing: Deezer's search is fuzzy and ranks by popularity, so
  this plugin takes an exact name match or nothing. An artist Deezer does not
  carry under the spelling your library uses is passed over quietly rather than
  answered with the nearest famous act, which would fill an hour with the wrong
  scene and look perfectly healthy while doing it.
- Similar artists from ListenBrainz, with no token needed

  The MusicBrainz plugin now also answers who sounds like an artist, using
  ListenBrainz's listening data. It is the same organisation's data under the
  same ids, which is why it lives here rather than in a plugin of its own, and
  it is now called **MusicBrainz and ListenBrainz** on the plugins page.

  The ListenBrainz token stays optional and does the same job it always did:
  enrichment in batches rather than one request a second. Similar artists work
  whether or not you have pasted one in, because the endpoint behind them is open
  to anyone.

  If you already run Last.fm, this sits alongside it. The station keeps every name
  both sources offer rather than picking between them, so the pool it programmes
  from gets wider.
- Records that sound like one record, from ListenBrainz

  When the station mixes similar records into a playlist it would rather ask
  "what do people play alongside this record" than "what else is by someone who
  resembles this artist". With a ListenBrainz token set, the plugin now answers
  the first question. Massive Attack's *Teardrop* comes back as Glory Box, Roads,
  Sour Times, Porcelain and In the Waiting Line.

  It needs the token because of how the data is keyed. MusicBrainz holds a
  separate recording id for every release a song appeared on, and the similarity
  data exists only against the one ListenBrainz treats as canonical; finding that
  one is a lookup only a token can make. Without a token the station keeps the
  answer it had, which is to reach for a record by a similar artist instead.

  This adds `labs.api.listenbrainz.org` to the plugin's network permissions,
  paced on the same budget as the rest of ListenBrainz.
- Name an artist's records from ListenBrainz, with a token

  Similar artists tell the station who to reach for; this is what it actually
  plays by them. With a ListenBrainz token set, the plugin now answers an
  artist's best known recordings, ordered by how much they are listened to.

  It needs the token, and says nothing without one. The endpoint behind it
  refuses anonymous callers, and the open endpoint that looks like a substitute
  is a radio sampler: asked for Daft Punk's best it offered a four-track medley,
  a mashup and a radio edit, and asked for Portishead's it offered album
  interludes and live takes. Records by the right artist that nobody would have
  chosen are worse than no answer, because the station has other sources and this
  one would have spoken over them.

  So: no token, and this contributes similar artists while Deezer or Last.fm name
  the records. With a token, all three answer and the station asks them in turn.
- Choose which similarity source the station asks first

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

## [0.19.3] — 2026-09-19

- The station now says so when Icecast has no source on its mount. Liquidsoap could be running and
  answering while Icecast answered 404 to every listener, and "Why it is quiet" reported that as
  waiting for a listener, who could never arrive. It is now "the stream is not reachable", with a
  sentence saying Icecast has no source and a remedy: restart Liquidsoap so it connects again. For the
  first thirty seconds it is a wait rather than a fault, since a restarted Liquidsoap reconnects on
  its own.

## [0.19.2] — 2026-09-19

- YouTube Music records now play from the station image. The service that finds a record's audio was
  built into the image but never started, so every fetch, and the provider's **Test connection**,
  failed with `ECONNREFUSED localhost:9322` however the provider was set up.

## [0.19.1] — 2026-09-19

- The check-up page's app link now reads **Open in the app**, because the Android app opens it as
  well as the desktop one, and a code beside it can be scanned with a phone to point the app at this
  station.

## [0.19.0] — 2026-09-19

- You can ask the station to read your playlists again now, rather than waiting for the next hour.
  **Refresh now** on the Playlists page reads every playlist on every music source, and **Refresh this
  playlist** in a card's menu reads just that one. New records reach the library in a few minutes, and
  the activity feed says when the walk is done. Refreshing one playlist never retires a record; only a
  walk of everything does that.

  The automatic walk is now yours to set, under Settings, Housekeeping: turn it off, or make it run
  every few hours instead of every hour. Refresh keeps working either way.
- A YouTube Music provider the station can search and play

  Search YouTube Music and import the playlists on your account, signed in with a
  cookie you paste. It reaches the live sets, sessions and uploads that are on no
  streaming service.

  Audio is resolved by `ytaudio/`, a new bundled Python service on yt-dlp that
  turns a track into a URL the station fetches itself, with nothing proxied. It
  resolves **signed out**: the cookie is used for search and your library only and
  never reaches the resolver, because YouTube serves signed-in sessions nothing the
  station can fetch, Music Premium included. A record that only an account may play
  (age-gated, members-only) is skipped rather than aired.

  The cookie has no refresh and expires on the account's own schedule. Because
  YouTube serves search to signed-out callers, an expired cookie would otherwise
  leave the station searching happily while the library went dark. So the plugin
  proves the credential by using it, at startup and behind Test connection, and
  reports a dead one as an authorization failure rather than as trouble at YouTube.
- Airing a playlist none of whose records is in the library now refuses, instead of reporting the
  station on air and playing only the bed. A record the catalog has never seen has no way to fetch its
  audio, so an order made of nothing else was consumed without a sound. The console now says the
  playlist is not in the library yet, and why: it is catalogued when its plugin syncs, and this one is
  either not listed by the provider or was added since the last sync. A playlist with some records in
  the library airs as before, and a catalog that cannot be read never causes a refusal.

## [0.18.0] — 2026-09-18

- A page on any other site can now read what your station is playing. `/api/nowplaying` answers
  without a sign-in as it always has, and now also answers a browser on another address, so a widget
  of your own, or the station directory at deadair.radio/community, can show the record and the show
  live. It says nothing it did not already say to anybody who asked, and every other route keeps
  answering only the console.

## [0.17.1] — 2026-09-17

- Pressing Test connection on a server that is not running no longer switches the plugin off. The
  three plugins that talk to something the operator runs themselves — both speech engines and the
  analyzer — reported an unreachable server by failing the call rather than by answering it, and the
  host counts a failed call towards the breaker: three presses quarantined the plugin, which for a
  speech engine is the station left with no voice and for the analyzer is a station that stops
  measuring, in both cases because somebody pressed the button that asks whether the server is there.
  They answer now, the address is in the answer, and none of it counts against the plugin.

  A failure on the wire also says what it was. `fetch` reports every one of them as "fetch failed" and
  hides the reason a level down, so "connection refused" — nothing is listening on that port — read
  exactly like a name that does not resolve and like a server answering on the wrong protocol. The
  reason and its code are now in the message, wherever a plugin's last error or a record's audio
  failure is shown.

## [0.17.0] — 2026-09-17

- A weather forecast and a news bulletin now say what they are on the stream itself: `Your Station -
  Weather in Brooklyn` rather than the station's name alone, on a car screen, a hardware radio and the
  listener apps alike. Talk breaks, idents and anything you add keep showing the station's name, since
  nothing can tell from a label alone whether it was written for a listener or for the person running
  the station — the break's own writer decides, and only the ones that produce a listener-facing line
  offer one.
- Disliking something now reaches the show that is already on air. Until now a dislike was applied
  where a running order is BUILT — when the station draws records, and when a playlist is put on air —
  so an order that had already been decided went on playing what you had just forbidden, sometimes for
  hours. Rating an artist, a record or a song `disliked` takes every record it forbids out of the
  running order straight away, and if one of them is what is playing, it is cut where it stands rather
  than allowed to finish. A break that had promised one of the departed records is rewritten while
  there is still time, and the station tops the order back up to make up the gap. Nothing changes about
  a like, which has always been a weighting on the next draw rather than an instruction.

## [0.16.0] — 2026-09-17

- The running order shows the picture a break wears. A weather forecast and a news bulletin already
  had one on the stream and in a listener's player; the order at the desk and on the phone drew a
  microphone against every break, so the same forecast looked like two different things depending on
  where you were standing. Both now draw the picture, and the microphone is what a kind with no
  picture falls back to.

## [0.15.0] — 2026-09-17

- A weather forecast and a news bulletin now have pictures of their own. Both used to wear the
  station's logo on the mount and nothing at all in a listener's app; each kind of break can carry its
  own artwork instead, which reaches the stream's artwork field, the phones, the desktop app and the
  console alike. The station ships one picture for `weather` and one for `news`, and an operator can
  replace either with their own under Settings → Artwork, or put the shipped one back. Every other
  kind of break still shows the station's logo, as the bed and off air do.

## [0.14.0] — 2026-09-16

- A phone-in joined into one piece of audio now takes up its real length in the running order. It always went in as one item and the item never said how long it ran, so the clock treated a ten-minute programme as taking no time at all and planted whatever came next on top of it: the news at the top of the hour arriving ten minutes into a call. An episode of somebody else's podcast has been placed with its length for a while; a programme the station made itself now is too, measured by the mixer that joined it rather than claimed by a publisher.
- Plugins can now offer text for the station to read out. A `narration` plugin says what series it has (a book, a newsletter, a queue of long reads), what instalments each one holds, and the words of one when the station asks for them. The station speaks it itself, in its presenter's voice, so a chapter gets the pronunciation lexicon and the performance cues the station's own words get. Nothing carries it on air yet; that follows.
- Put a narration band on the format clock and the station reads at that time: the next chapter of a book, or the newest issue of a column, in the presenter's voice, with a talk break in front of it introducing what is coming. The mount names the piece and the series while it plays, and the station remembers where it got to, so tomorrow's band reads the next chapter rather than the same one. A band with nothing left to read goes quiet and says why rather than airing something else.
- The station can now read a piece out loud. Ahead of a narration band's slot it fetches the words, splits them into as few parts as its speech engine will take, and speaks each one in the presenter's voice, with the pronunciation lexicon and everything else the station's own words get, then has the mixer join them into one recording. It works well ahead of time and yields to anything the presenter needs now, so a chapter being made never delays a break. Nothing airs it yet; the band that places it follows.
- A Readings page in the Library, beside Podcasts: what the station has been given to read, every piece of it, and where the station has got to. Each one says whether it has been spoken yet, is being spoken now, or could not be and why, and any of them can be read out of turn. A narration band's topic can pick a series from the same list rather than needing an id typed in.
- The station now keeps track of what it has been given to read out. A narration plugin says what series it offers (a book, a column, a queue of long reads), and the station remembers every piece of each, in the order that series is worked through: a book from its first chapter, a column from its newest issue. It re-reads the list twice an hour, and the Clock can point a `narration` band at one of them. Nothing is spoken or aired yet; that follows.
- A speech plugin can now say how much text its engine takes in one go, and the station knows how to cut something longer than that into as few calls as will fit. It cuts at the strongest boundary available, between paragraphs first, then between sentences, then between words, because a cut mid-sentence is audible where a slightly longer call is not. Nothing a presenter says is anywhere near any engine's limit, so no break changes; this is groundwork for reading something long out loud.
- A phone-in being made for later no longer holds the speech engine in front of the breaks the presenter needs now. Its beats were queued at the same rank as anything on air, so a break planted while a programme was being spoken waited behind every remaining beat of it. A programme now yields to the station while its slot is far off and takes precedence as that slot approaches, which is the same earliest-deadline rule its writing already followed.
- A mistyped `DATABASE_PORT` now stops the station with a message naming it. It was read as `config.get('DATABASE_PORT', 55432)`, which types as `number` and answers the string `'5432'` whenever the variable is actually set, and worked only because `pg` coerces it on the way into the socket. A value the parser could not read took the same path and became `NaN`, which is falsy, so `pg` read it as a port nobody set and fell through to `PGPORT` and then to its own 5432: `DATABASE_PORT=54 32` surfaced as a refused connection, or as authentication against whatever else answers on 5432, rather than as the two characters that caused it. It goes through `requiredNumber` now, like `REDIS_PORT` beside it, which refuses a value that is present and unreadable and falls back only for a key nobody set. Its tests passed the port as a real number for as long as they existed, which proved nothing about a resolver whose whole bug was the string, so they pass strings now and the fixture type refuses anything else.
- The station can be pointed at a Redis that asks for a password. It read `REDIS_HOST` and `REDIS_PORT` and nothing else, so an operator whose cache wants `AUTH` had no way to say so and [#160](https://github.com/robert-dean/deadair/issues/160) ran a second Redis daemon beside the one they already had. `REDIS_USERNAME`, `REDIS_PASSWORD` and `REDIS_TLS` now sit beside the address (a Redis with only `requirepass` set takes the password alone and no username; `REDIS_TLS` is the connection rather than the password, and without it the password travels in the clear), and `REDIS_URL` takes the whole thing as one string instead, which is the shape a hosted Redis hands you and the only way to name a database index. Set the URL and it is the entire answer: the five discrete variables are not consulted at all, because a merge of the two is a station connecting to the right host as the wrong user, and the `full` image fills the loopback ones in itself. A URL it cannot read stops the boot rather than falling back to localhost, and no message about it ever quotes the value, since a Redis URL carries the password. `REDIS_PASSWORD` and `REDIS_URL` are scrubbed from `process.env` after the config snapshot resolves, like the database password already was. Everything that talks to Redis (both rate limiters, the sign-in mail limiter, the cache and the session store) shares the one client, so all of it is covered. `REDIS_PORT` is read through `requiredNumber` in the same pass: it was handing ioredis the string `'6379'` whenever it was set and working only because the connector coerces it, so `REDIS_PORT=63 79` was a `NaN` port rather than an error naming the variable.

## [0.13.3] — 2026-09-16

- A station whose records come from Navidrome is no longer told it is not authorized to fetch audio. The desk's attention list decided which plugin feeds the station's track fetcher by looking for the `stream` capability, which Navidrome declares too — it puts records on air by minting its own URLs and has no use for the fetcher's Spotify login. Because the shim runs in every image and holds no stored login until somebody authorizes it, every Navidrome-only station saw a permanent `failure` row telling it to go and authorize a fetcher it never touches, routed at a plugin page that correctly offers no such card. The list now reads the `trackFetcher` permission, which is the fact the plugin page was already moved onto and the only one that says a plugin's audio goes through the shim.

## [0.13.2] — 2026-09-16

- A record now reaches air with the station's own cover rather than the provider's, even when it was picked before the art store had one. The running order stores the cover a record was picked with and nothing revisited it, so a cover fetched afterwards never reached the record it belonged to and that record aired under the station's logo. The director now resolves it on every commit pass and asks for any cover the store has never seen, ahead of the scheduled sweep, which walks the catalog alphabetically and has no idea what is on tonight. A cover that is late, failed or unreadable still just shows the logo and never holds up a record.

## [0.13.1] — 2026-09-16

- Cached artwork is served under a filename as well as under its id: `GET /art/{id}/{filename}` answers the same bytes, chosen by the id, and catalog reads now mint `art/<id>/cover.<ext>` from the extension the store recorded. This is what a hardware player needs before it will fetch a cover at all, since it decides whether a URL is a picture by looking at the URL rather than by asking. An asset with no recorded extension keeps its bare `art/<id>`, and every existing URL still works.
- A setting that says "leave empty to …" now shows what empty actually comes to. Three of them do: the public URL falls back to the address the station was deployed with (`SPA_BASE_URL`, then `APP_BASE_URL`), the advertised hostname to the public URL's, and the station timezone to whatever the server is set to. Until now the console could only repeat the sentence, because the values are worked out server-side and nothing on the wire carried them, so an empty Public URL showed `https://` — a hint, not the address listeners are actually being sent to. `GET /settings` gained a `derived` map beside `values` and `configured`, and the console draws each entry twice: as the empty field's watermark, and as a line under it ("Using https://… while this is empty."), because a placeholder alone reads as an example of what to type and is not reliably announced to a screen reader. Every entry is what the station WOULD use with the box left empty rather than what is in force, so a field somebody has filled in still reports what clearing it would mean, and the line answers to what is typed rather than to what is stored. The advertised hostname's `localhost` floor is carried through rather than hidden: that is genuinely what Icecast calls itself with nothing to go on, and it is the thing the live station's empty public URL was quietly doing.
- The artwork the mount broadcasts is now only ever the station's own. A provider's cover URL is never put on the wire: a player will not fetch one, since it ends in an id rather than in a picture's name, and the field reaches every listener, so a Subsonic cover link would have handed the operator's own credentials to anybody who connected. A record whose cover the station has cached carries it, and anything else carries the station's logo.

## [0.13.0] — 2026-09-16

- A break the model nearly got right is now put back to it once, rather than going straight to the station's fallback phrasings. When a script is refused for something the model can act on — it did not sound like the character, it used wording the persona forbids, it reached for a signature just used, it read a sample line back, it named the wrong part of the day, or it answered with nothing — the same writer is asked again, told which rule it broke and shown what was refused. Refusals about the records themselves (a break about neither of them, a record announced on the wrong side, an invented year) are not retried: those mean the model misread what it was given, and asking again invites it to invent something that fits. The second ask waits only as long as the break's own deadline allows, so it can never make the station late, and both attempts are recorded, so the refusal and the rewrite are both in the history.
- The audio chain's log level is a station setting. `stream.logLevel` is Liquidsoap's own 1-5, offered as a named menu ("Normal", "Debug — for diagnosing a fault") and materialized into `radio.env` as `LOG_LEVEL`, so the config watch restarts Liquidsoap with it like any other stream setting. It was reachable only as a container variable before, which on unraid means editing the template and which nothing in the console could show — and on 2026-09-16 the diagnosis of an audio chain that took a record and never resolved it ended at "raise the level and wait", because the layer that stopped only logs at 4. Two things the help text says because they are not guessable: a restart CLEARS a stuck chain, so this is for leaving on and waiting for the next occurrence rather than for turning up during one; and at 4 and above the log holds the playout bridge secret in plain text, which is why reading logs is `platform.manage`. The resolver reads it through `numberFrom` rather than `numberOr`, because `Number('')` is 0 and finite, so a blanked box would have resolved to zero and clamped to 1 — a station that quietly stopped reporting its own faults.
- The production image rotates the audio chain's and track shim's logs. Neither was bounded by anything: Liquidsoap has no rotation setting at any version and the shim's supervisor holds one append redirection across every restart, so both grew for as long as the station ran. Measured on the live station, `liquidsoap.log` was 15.5 MB after thirteen days at the default log level, on the same volume as the database, and already past the 8 MiB a download reads — so more than half of it could not be reached from the console at all. A new `log-rotate` service runs logrotate on a timer with `copytruncate`, which is required rather than preferred: neither writer reopens its log, so a rotation that renamed the file would leave both appending to an inode with no name and the console showing a log frozen at the moment of the rotation. `su deadair deadair` is what lets it work on an unraid share made with the usual 777, and the service takes any existing log to 99:100 first because `su` then refuses a file that user does not own. The segments stay uncompressed with logrotate's `.1` naming because the app reads them back as one history. `LOG_ROTATE_INTERVAL_S` (300, `0` disables), `STREAM_LOG_MAX_SIZE` (`8M`) and `STREAM_LOG_KEEP` (3).
- The audio chain and track shim logs are read back across their rotated segments rather than only out of the active file. Nothing rotated them before, so the reader knew about one file; the image rotates them now, and a reader that still knew about one would show an operator LESS after rotation than before, and almost nothing in the minutes after a rotation — which is exactly when somebody is looking. `readSegmentedTail` walks `name.log`, `name.log.1`, `name.log.2` … newest first until the byte budget runs out, so the console's view is the newest 512 KiB (a tail) or 8 MiB (a download) of retained history wherever it happens to live, which is what the unbounded file used to give it. `measureSegments` sums the set for the size beside the source, because an operator told "8 MB" next to 32 MB of disk is being told the wrong thing about their own storage. The segments must stay uncompressed for this to hold, and the rotation config says so from the other side.

## [0.12.3] — 2026-09-16

- The mount carries artwork as well as a title. Every ICY update now fills the `StreamUrl` field beside `StreamTitle`: a record's cover, made absolute against the station's public URL, or the station's own logo for a break, the bed and off air, so a player that reads the field never shows the previous record's cover under the wrong caption. The public URL is derived from the console address the station was deployed with (`SPA_BASE_URL`) when the setting is empty, which also gives Icecast a real advertised hostname on a station that never filled it in. `stream/streamurl.check.py` measures whether a given player draws the field, against a throwaway mount rather than the station's; an NAD M10 V2 on BluOS 4.16.22 does, per record, with no reconnect.

## [0.12.2] — 2026-09-16

- Callers stop being offered as hosts, and a broadcast refuses one. `GET /personas` answers with the whole roster, hosts and callers together, because the personas page draws both — so narrowing it is each surface's own job, and three of them had never done it: the on-air "Presented by" menu, "Hosted by" on a slot or a briefing box, and a production's presenter. Picking a caller there was not cosmetic. `DirectorConsoleService.recast` checked only that the persona existed, so the caller presented the show and `SegmentRepository.recast` rewrote every break in the tail in the character of somebody whose whole premise is that they are phoning in. `recast` now refuses a caller with the sentence `PersonasService.setDefaultHost` already used, and every console surface that offers a host narrows through one `presents` predicate rather than four copies of `kind !== 'caller'`. `putOnAir` still takes a persona id on trust, deliberately and for its own reason, so the endpoint half of that path is unchanged.
- "Hosted by" says the station's own host with an apostrophe. Its description carried `’` as six literal characters, and a JSX string attribute is HTML-like: it processes HTML entities but no backslash escapes, so every surface that draws this field — the slot editor, the briefing box and the sustaining panel — read "Empty means the station’s own host."
- The deadpan wisecracking host's checkable words are re-measured over 694 of her own scripts, after three auditions of the same playlist. `that was a choice` becomes `was a choice`, which catches the "That indeed was a choice" form that was being refused without being loose enough to insert as a noun; `somebody was paid to`, which fired on none of the 694, and `marvellous`, which fired on four, give their places to `one might` and `perhaps`. Her `avoid` list gains the critic's vocabulary the first pass missed — `merely`, `exercise`, `substance`, `spectacle` — and a persona's `avoid` cap rises from 12 to 16 so a sheet can forbid a whole register rather than a handful of phrases, which is what `slacker` and this character both need it for. Her diction now caps the number of her own phrases per break as well as the number of asides, since one audition break carried three.

## [0.12.1] — 2026-09-16

- The deadpan wisecracking host seed stops reviewing records. An audition of twenty breaks came back as record reviews with one of her phrases bolted to the end ("the production, shepherded by Mike Clink at Rumbo Recorders, offers a veneer of technical polish"), which passed her own character check every time because the phrase was present. Three changes: her opening quirk now states the move rather than the attitude (take one decision somebody made, literally, and say what it promised); a new quirk forbids reviewing the record at all; the critic's vocabulary is in `avoid`, which is the only half of a sheet that refuses a script rather than asking; and she carries `brevity: short` beside her `unleashed`, so she keeps the room to say anything and is told to say it in one line.

## [0.12.0] — 2026-09-16

- The persona flag that says who the station's own host is has been renamed from `active` to `defaultHost`, everywhere: the `personas.default_host` column (migration 0031, applied at boot), the `Persona` contract and all four SDKs, and `PUT /personas/{id}/active`, which is now `PUT /personas/{id}/default-host`. Nothing about who presents changes; the old name said "on air", which it never meant during a broadcast that named its own host, and the console badged the wrong character for exactly that reason. The Personas page button now reads **Make station host** rather than "Put on air", and the desk's persona pickers mark whoever is actually presenting. The operator desk on macOS follows the same rename, and its Voice page lamp now marks the character presenting rather than the station's own host.
- The Personas page now says who is **On air now** rather than marking the station's own host and calling that the same thing. They differ whenever the broadcast on air names its own host: the character presenting the show writes every break, while the station's own host is the one who takes over when a broadcast names nobody. That card is now badged **Station's own** instead. `Persona` gains a readonly `presenting`, derived per request from the running order through the same precedence a break uses, so it can never drift from who is actually speaking; the desk's "Presented by" badge reads it instead of working the fallback out for itself. The stored flag is unchanged and still `active`.
- Spotify playlists you follow but do not own now work. An editorial playlist, a Daily Mix, a playlist a friend made: all of them were listed with **Spotify won't share this playlist's tracks** and can now be viewed, aired, picked for a schedule block and used for a persona audition, because the station's own track fetcher reads them on the login it already holds for fetching audio. It needs that fetcher authorized (Plugins → Spotify → the playback authorization card); without one, those playlists read exactly as they did before.

  Two things follow from it. The hourly library sync now reads those playlists too, so the records in them join your library from the next run: hide a playlist from its card on the Playlists page to keep it out. And Spotify marks almost nothing on this path as clean or explicit, so a station set to **clean only** will play very little from a followed playlist, which is the honest outcome rather than a station vouching for records nobody vouched for.

  For plugin authors, `PluginTrackFetcher` gains `playlistTracks(request)` for the playlist your own API lists and then refuses.

## [0.11.1] — 2026-09-16

- The deadpan wisecracking host seed keeps the listener's taste as a target, beside the one it gained last release. She is rude about the decision to be sitting there listening to this AND about what somebody decided to call it, with the record itself as her evidence rather than her subject. The fence is two cuts of one kind: their taste is fair game and they are not, and a name somebody chose is fair game and the person who has it is not. A station that already has her keeps its own sheet: seeds are only written to an empty station, and "Restore built-ins" adds missing ones without overwriting.

## [0.11.0] — 2026-09-16

- Any playlist can now be hidden from its card on the Playlists page: open the **⋯** menu on the card and choose **Hide**. A hidden playlist moves into **Show N hidden** at the bottom of the page, is no longer offered in the schedule, sustaining and programme pickers or in persona auditions, and the library sync stops reading it, so records that only it held leave the library the way they would if the playlist were deleted. Choose **Show again** on its card to undo it; nothing is deleted. A schedule block or setting that already plays from a playlist you then hide keeps playing from it. The pickers also stop offering playlists their source refuses to share, since those could only fail at air time. Hiding needs an admin. New table `hidden_playlists` (migration 0030); `CatalogPlaylist` gains an optional `hidden`; new `PUT` and `DELETE /playlists/{pluginId}/{playlistId}/hidden`.
- The playlists Spotify makes for you (Discover Weekly, the Daily Mixes, Release Radar and its editorial lists) no longer fill the Playlists page with cards Spotify refuses to share. They now sit behind **Show N made by Spotify** under your own playlists, and the count at the top counts only the ones a person made. Nothing is removed: open the button and they are all there. For plugin authors, `ProviderPlaylist` gains an optional `madeByProvider`, and `CatalogPlaylist` carries it through.
- The running order on the Desk can now skip straight to a record further down it. Each record still to come carries a **Skip to** button beside Play next: pressing it passes over everything in front of that record, including anything the player had already been handed and the breaks between, cuts what is on air, and plays the record next. The records passed over show as skipped, and a break that was being written for one of them is written off. Only a record can be skipped to, not a break, since a break's words are about the records around it. With nothing on air, the order moves and the station starts from that record when it next airs. The new route is `POST /director/air/items/{itemId}/skip-to`, `skipToARunningOrderItem` in the SDK.
- The deadpan wisecracking host seed now makes fun of what a record is called rather than the record itself: the title, the band name, the album title, and the fact that somebody approved a sleeve. She likes the music and plays it straight, and she no longer goes after the listener's taste. A person's own name is off limits (she goes for the title instead), and because the writer is never shown the cover art, she may wonder who signed it off but never describes it. A station that already has her keeps the old sheet: seeds are only written to an empty station, and "Restore built-ins" adds missing ones without overwriting.

## [0.10.0] — 2026-09-15

- A playlist can now be aired with similar records mixed in, the way Spotify's smart shuffle does it. Every few records of the playlist, the station adds a record by an artist who sounds like the one just played, found through a similarity plugin such as Last.fm; the playlist itself still plays in full and in its own order around them. Choose **Air with similar records mixed in** from the arrow beside Air this playlist, or turn on **Mix similar records into a playlist** under Settings, Rotation to have every playlist do it, with the spacing beside it (four of the playlist's records between mixed-in ones by default). It is off by default, a setlist or a feature never has anything mixed in, and every mixed-in record passes the same rules and dislikes as anything else the station picks. A mixed-in record never lands beside a break, so nothing the presenter has already said about the next record is made wrong. The activity feed says how many were found, and says so when none could be. `PutOnAirInput` and `PlayoutPlaylistInput` gain an optional `mixInSimilar`.

  On the Desk, a record the station mixed in carries a **mixed in** badge, so you can tell it from the ones the playlist named. `StationOrderItem` gains an optional `mixedIn`.
- A similarity plugin can now name records that sound like one record, not only artists who sound like one artist. `SimilarityProvider` gains an optional `similarTracks(ref, limit)`, taking the enrichment capability's `TrackRef` and answering `ArtistTrack`s, each with its own lead artist. The Last.fm plugin implements it with `track.getSimilar`, asking by MusicBrainz recording id when the catalog has one. When a playlist mixes similar records in, the station now asks about the record each one follows first, and falls back to that record's artist when nothing usable comes back or no plugin can answer. A plugin without the method behaves exactly as before.
- A schedule block that plays a playlist can now ask for similar records to be mixed in among it. The block editor shows **Mix in similar records** whenever the block plays from a playlist; ticked, every changeover to that block mixes neighbours in the same way Air with similar records mixed in does, and left unticked the station's own **Mix similar records into a playlist** setting decides. `ScheduleSlot` gains an optional `mixInSimilar`, stored in a new nullable `schedule_slots.mix_in_similar` column (migration 0029).

## [0.9.0] — 2026-09-15

- `parseFeed` reads what a podcast feed carries. An entry now reports its audio attachment as `enclosure` (from RSS `<enclosure>` or an Atom `<link rel="enclosure">`, preferring an audio one, http(s) only), how long it runs as `durationMs` from `itunes:duration`, and its artwork, explicit marking, season and episode number. A feed reports its own description, author, artwork, language, categories and explicit marking. Every field is optional, and `url` is still only ever the page, so a news reader sees exactly what it saw before.
- A new `podcast` capability lets a plugin say what programmes the station subscribes to and what each has published: `listShows`, `listEpisodes` (newest first, each episode carrying the address of its audio, how long it runs by the publisher's account, and its summary), and an optional `searchShows` directory. The plugin never fetches the audio; the station fetches it itself, ahead of the slot it airs in. It is deliberately not a music provider, because an episode is not a record, and the README's new "Carrying podcasts" section says why.
- The station can fetch a podcast episode's audio into its own store, where it becomes a segment ready to air, with `POST /podcasts/episodes/{id}/fetch`. The download follows the analytics redirects podcast audio sits behind, refuses any address that resolves to this machine or its network, decides what the file is from its first bytes rather than from what the publisher says, and streams to disk under a 256 MB ceiling. On air an episode is named on the mount by its title and its show, reported to listeners as a programme rather than as the station talking, levelled from the loudness a mastered podcast has rather than the station's quieter speech engine, and kept out of play history and scrobbling. Episodes are never drawn at random from the segment shelf.
- A bundled Podcasts plugin reads the podcast feeds an operator subscribes the station to: one row per show with its feed address, each show described from its own feed, and its episodes listed newest first with the address of their audio and how long they run. It can also look a show up by name in Apple's public podcast directory, which is on by default, can be switched off, and can be pointed at a country's store. It never fetches an episode's audio itself, so the only addresses it asks to reach are the feeds and the directory. Nothing on the station uses it yet.
- The Library has a Podcasts tab. It lists the episodes the station knows about, newest first, with whether each is fetched, ready to air or aired, why a fetch failed, and a button to fetch one now or try again. It can read every feed again on request, and it can look a show up in Apple's podcast directory and subscribe to it, which adds the show to the Podcasts plugin's own list of feeds. `GET /podcasts/search` is the directory search behind it. Durations of an hour or more now read as hours everywhere in the console, including the desk's counters while a programme airs.
- The station keeps a record of the podcast episodes it knows about. Every half hour it reads the newest episodes of every show its podcast plugins carry and remembers each one, with what the feed said about it and, later, whether the station fetched its audio and whether it aired. `GET /podcasts/shows` lists the shows, `GET /podcasts/episodes` lists the episodes newest first, and `POST /podcasts/refresh` asks for a refresh now. The typed SDKs gain the matching `podcasts` client.
- The presenter hands over to a programme and comes out of it. When a podcast episode is scheduled and the station's breaks are on, a talk break is planted in front of it, and a break written beside a programme is told what it is: the show, the episode, how long it runs and what the publisher says it is about, described as a programme rather than as a record. A break that promises the programme is dropped if the programme leaves the running order. Lengths of an hour or more are given to the writer in hours and minutes.
- A podcast can go on the format clock. Add a show as a topic of the new `syndicated` kind, then put a `syndicated` band on the schedule about it: three hours before the slot the station fetches the show's newest episode, and at the slot it airs it, if it has not aired it already. A band declines rather than airing an older episode or a different show, and a programme is still carried when the station's own talking is switched off. An episode's stated length now counts on the station's clock, so a bulletin at the top of the next hour lands after the programme rather than an hour early, and a bulletin at the boundary a programme ends on is kept rather than dropped as a second break. Plugin settings can offer the shows the station carries with the new `station.podcastShows` option source.
- `parseFeed` no longer drops an entry whose title is written twice. A podcast entry usually carries both `<title>` and `<itunes:title>`, which arrive together once namespace prefixes are removed, and every such entry used to be discarded as untitled. The first readable one is now used, for every field read this way.

## [0.8.3] — 2026-09-15

- A programme booked on the format clock is commissioned once. The time a clock band next falls due used to carry the milliseconds of the moment it was asked, so every pass of the station's scheduler saw the same slot as a new one and could commission the same phone-in or podcast again, as often as every pass for the three hours before it aired.
- The eighties persona seed is now a valley girl, Tiffani, in place of the bright video-age jock. She talks in uptalk, loves whatever the station plays because it is on the radio, and cannot understand the music nobody plays. A station that already has the old jock keeps him: seeds are only written to an empty station, and "Restore built-ins" adds missing ones without overwriting.
- A title, artist or album the model wrote in markdown italics or bold (`*Electric Eye*`) now keeps its words and loses only the asterisks. Every `*...*` run used to be deleted as a stage direction, which aired breaks with a hole where the record's name had been and refused others for naming neither record they were shown. A run that reads as a stage direction (`*laughs*`, `*sighs*`) is still dropped.
- The valley girl seed is revised after her first audition. She uses "like" as a discourse marker (the filler, "I was like", and "like, four of them"), her uptalk is a statement going up rather than a question tacked onto the end, and her disgust slang is no longer spent as praise. She now stays loyal to a record on air that sounds like the music she cannot stand, and she no longer jokes about a death.

## [0.8.2] — 2026-09-15

- A pronunciation entry for a name that starts with punctuation (`?uestlove`, `.38 Special`) now matches. Taking a soundboard hit out of a script no longer closes every space in front of punctuation elsewhere in it, which had glued such names to the word before them, in the stored script as well as on the way to the engine.
- What a pronunciation entry says now reaches the speech engine exactly as it was written. A respelling with stressed syllables in capitals (`UN-guhr`) is no longer read as an initialism, and Kokoro's inline phoneme markup (`[Jordache](/ʒɔrdæʃ/)`) keeps its brackets and slashes.

## [0.8.1] — 2026-09-15

- The eighties persona seed is now a valley girl, Tiffani, in place of the bright video-age jock. She talks in uptalk, loves whatever the station plays because it is on the radio, and cannot understand the music nobody plays. A station that already has the old jock keeps him: seeds are only written to an empty station, and "Restore built-ins" adds missing ones without overwriting.

## [0.8.0] — 2026-09-15

- API keys, for a script or an integration that should reach the station without your password. Settings → Security has a new card to create one, read-only or read-and-manage, with an expiry if you want one; the key is shown once, and can be rotated or revoked from the same card. A key acts as your account and never does more than it can, so a listener's key only reads. It cannot sign in, change how you sign in, or make other keys. Send it as `Authorization: Bearer da_…`.

## [0.7.1] — 2026-09-14

- A break that uses a time of day in a comparison ("the riffs hit like an unmarked car at midnight", "smooth as a midnight train") is no longer sent to the floor for naming the wrong time. Saying it is midnight when it is not is still refused.

## [0.7.0] — 2026-09-14

- The typed client for the station's API is published to npm as `@deadair/sdk`, beside the plugin SDK, carrying the station's version, so the SDK that shares a station's version number is the client for that station. It is the client the console is built on, with Luxon's types now among its dependencies so a TypeScript project gets typed dates without installing them itself. The repository has a small example client in `examples/sdk/now-playing`, which CI builds against the SDK as it would be published.

## [0.6.0] — 2026-09-14

- The station now restarts its audio chain when it gets stuck. The audio chain can stop playing what it is handed while still looking alive, which leaves listeners on the fallback bed until somebody restarts the container. Now, if it holds a record for a minute without playing it, or does not answer at all for a minute, the station asks for it to be restarted, and it is back within about twenty seconds with the running order where it was. It asks at most once every five minutes and gives up after three restarts that did not help, and every restart, and giving up, is in the activity feed. A stuck audio chain is also now killed after ten seconds if it will not stop on its own, including when a stream setting changes. The new "Restart the audio chain when it gets stuck" setting under Playout is on by default; turn it off to leave a stuck chain alone and look at it.

## [0.5.1] — 2026-09-13

- Mail works with a server that has a self-signed certificate. Settings → Mail has a new switch, "Check the server's certificate": turn it off and the station stops failing with "unable to verify the first certificate" against a mail server with its own certificate, or one from your own certificate authority. It stays on by default, and should for any server reached across the internet, because with it off the station cannot tell your server from something pretending to be it.

## [0.5.0] — 2026-09-13

- `GET /nowplaying` now says what programme is on and who presents it, and whether the station is playing a record or talking. The new `show` field carries the broadcast's name and the host's on-air name: the persona's own on-air name, or the station's presenter name from Settings when the persona has none, and nothing when neither is set. The persona's console label is never shown. `track.kind` is `record` for music and `break` while the station speaks on its own between records, such as an ident, a bulletin or a talk break; during a break `artist` is empty and `title` is the break's label. A presenter talking over the start of a record still counts as the record. Both fields are additions, so existing players keep working, and a station on an older version reads as always playing a record with no show named. The route still answers without touching the database, so polling it costs the station nothing more than before.
- The check-up's list of mounts ends with Open in the desktop app, which hands this station's address to the desktop app.

## [0.4.2] — 2026-09-13

- A break whose audio could not be made because the speech engine was not ready is now asked for again, instead of being passed over at its slot. When the voice server is still loading its model, or cannot load it because another model is holding the GPU, the station keeps the break's words and waits. Nothing ever came back for those breaks: only a welcome was tried a second time, so every other break turned away at the start of a listening session was lost. The station now asks for their audio again each time a record changes while the break is still coming up, and the activity feed says so, as it already did for a break whose render failed outright.

## [0.4.1] — 2026-09-12

- The console's Copy buttons work when it is opened over plain HTTP at a network address, such as `http://192.168.1.10:8080` on a home server. Before, they copied nothing there and said nothing either, because the browser only offers the clipboard function they used on HTTPS or on localhost. They now fall back to the browser's older way of copying, and if that is refused as well the button reads "Copy failed" and shows the text already selected, ready to copy with the keyboard. This covers the restart command on the silence diagnosis and the stale-config alert, the plugin OAuth callback URL, the authenticator key during enrolment, and the build revision and stream addresses on the check-up.

## [0.4.0] — 2026-09-12

- Smart shuffle: records the station has aired lately are now less likely to come round again soon, so the rotation works through more of your library before it repeats itself. It is a lean rather than a rule. A record that has just aired keeps a quarter of its usual chance of being drawn and warms back up evenly over a fortnight, anything outside the repeat window can still play, and a small library still plays everything it holds. It is on by default, and Settings > Rotation has a Smart shuffle switch and the number of days a record stays cold. The similarity mix leans the same way, taking a fresher record from each similar artist rather than always their best known, and a model choosing records now sees on each search result how many days ago it aired, so it can prefer one it has not played lately. Turning it off restores the previous behaviour exactly. The Shuffle button on the desk is smart too: it keeps one artist off its own heels and moves anything aired lately toward the back of what it shuffles.
- The console works when it is opened over plain HTTP at a network address, such as `http://192.168.1.10:8080` on a home server. Before, every request it made failed in the browser before reaching the station, because the browser only offers one of the functions it used on HTTPS or on localhost, and the console reported that as "Can't reach the station". Enrolling an authenticator app or an email address from a console reached that way works too; it failed for the same reason.
- Signing in with Google now comes back to the station instead of the console's not-found page. The station told Google to return the browser to an address the console answers rather than the API, so the sign-in finished at Google and went nowhere. The address is now `<public address>/api/auth/login/oidc/callback`, and it is the one to register as the authorized redirect URI in the Google Cloud console: an OAuth client still registered with the old address is refused by Google until it is changed.

## [0.3.0] — 2026-09-12

- A talk break can now be read hushed or frantic. The model writing it chooses, and only when the speech engine can perform it: on Chatterbox that means the original or multilingual model, since the Turbo model performs laughs and sighs instead and ignores these dials. Each Chatterbox voice can also carry its own exaggeration and CFG weight, which sets how theatrical that character is at rest, and Test connection says whether the loaded model uses them. The segments page shows a break's reading beside its voice, and speech plugins get a documented way to translate the same two words into whatever their engine has.
- A plugin can now be imported from Settings → Plugins, as the tarball `npm pack` writes, with no shell on the box. It arrives switched off, as one copied in by hand does. Importing a newer version of an installed plugin replaces the old one and takes effect at once, with its settings kept; importing the same version again says the station needs a restart to run it. An installed plugin can also be removed from its page, which deletes its folder and keeps its settings.

## [0.2.4] — 2026-09-12

- Shuffling the running order while nobody is listening no longer makes the station jump to the record it had lined up before the shuffle when a listener arrives, skipping everything the shuffle put in front of it. The shuffled order now plays from its new first record, and the same holds for moving or adding an item at the head.

## [0.2.3] — 2026-09-11

- An audition now keeps what the model wrote for a break the station refused, beside the reason, so a decline such as "read a sample line back" can be checked against the words.
- The presenter no longer reads a reissue's "2014 remaster" or "2004 remix" out as part of a title, and a break that names such a record by its plain title is no longer refused for naming neither record.
- A break that says the sky is doing something it is not ("Night falls" in the afternoon, "Sunrise" at eleven) now goes to the floor like one that says "tonight" at the wrong time. Night and sunrise in the host's own story, in similes and in record titles are still allowed.

## [0.2.2] — 2026-09-11

- The presenter no longer reads a reissue's "2004 Remix" out as part of the title, and no longer doubles a full stop after a name that already ends in one, such as R.E.M.

## [0.2.1] — 2026-09-11

- The plugin SDK on npm is now published by the release itself, with a provenance attestation that ties each version to the commit and the workflow run that built it. 0.2.0 was published by hand and has none. Nothing in the SDK's API changes.

## [0.2.0] — 2026-09-11

- A station can now run plugins it did not ship with. Copy a plugin into `plugins/` on the data volume and press Rescan: the station lends it its own SDK, where before every such plugin failed to load. The console marks a plugin you installed, and one that failed to load names the folder it was read from. The plugin SDK is published to npm as `@deadair/plugin-sdk`, and deadair.radio has a new section on writing, testing and installing a plugin, walking through a complete example.
- Navidrome's plugin page no longer shows the playback authorization card. That card authorizes the station's own track fetcher, which only Spotify uses. Navidrome was being offered a Spotify login it has no use for and, once enabled, a warning that every record would be dropped.

## [0.1.0] — 2026-09-09

The first release. Everything below has been running on one station for some time; what is new is
that there is now a number to name it by.

### The station

- **A running order, owned by one thing.** A forward lineup several hours deep, every item carrying
  its own state, with the director as its only writer — the console, the schedule and the model all
  post commands to it rather than writing it themselves.
- **A presenter that cannot be silenced by a model.** Breaks are written by a local or hosted model
  when one is configured, by the operator's own phrasings when none is, and by the station's own
  five underneath both. The floor cannot fail.
- **Facts, or nothing.** A claim the presenter states on air is a stored row carrying the sentence
  of source prose that supports it. A claim with no source is not expressible in the schema.
- **Personas that accumulate.** A character sheet, a voice, a notebook of what it has said and
  anecdotes it can tell, plus auditions and rehearsals that never reach air. Phone-ins are produced
  as a cast of personas trading turns, each its own model call, joined into one file before it airs.
- **Measurement before air.** A Python sidecar decodes each record and answers with its cue points
  and its loudness, so silence is trimmed and boundaries are sized from what the material does.
- **An answer to "why is it quiet".** Eleven ordered gates over one snapshot produce a single causal
  verdict, written to the station's own event log.
- **A format clock and a weekly schedule**, a catalog with the station's opinion of every record at
  three levels, and an activity feed of what actually happened.

### Around it

- **One container** carrying the station, its console, the audio chain, the stream server and the
  sidecar, in three variants: `slim`, `latest` and `full`.
- **Plugins** for music providers (Spotify, Navidrome), enrichment (MusicBrainz, Last.fm,
  Wikipedia), news (RSS), web search (SearXNG, Brave, Tavily), weather (Open-Meteo, the US National
  Weather Service, OpenWeatherMap), speech (Kokoro, Chatterbox), models, and the measurement
  adapter.
- **Listener apps** for Android and macOS, released separately and on their own schedules.

### Known limits

- **Images are `linux/amd64` only.** There is no arm64 build yet.
- **There is no MFA recovery code.** A lost authenticator is recovered against the database; the
  procedure is in the README.
- **`latest` follows `main`.** Pin `0.1` to track releases only.

[Unreleased]: https://github.com/robert-dean/deadair/compare/v0.24.0...HEAD
[0.24.0]: https://github.com/robert-dean/deadair/compare/v0.23.0...v0.24.0
[0.23.0]: https://github.com/robert-dean/deadair/compare/v0.22.0...v0.23.0
[0.22.0]: https://github.com/robert-dean/deadair/compare/v0.21.0...v0.22.0
[0.21.0]: https://github.com/robert-dean/deadair/compare/v0.20.0...v0.21.0
[0.20.0]: https://github.com/robert-dean/deadair/compare/v0.19.3...v0.20.0
[0.19.3]: https://github.com/robert-dean/deadair/compare/v0.19.2...v0.19.3
[0.19.2]: https://github.com/robert-dean/deadair/compare/v0.19.1...v0.19.2
[0.19.1]: https://github.com/robert-dean/deadair/compare/v0.19.0...v0.19.1
[0.19.0]: https://github.com/robert-dean/deadair/compare/v0.18.0...v0.19.0
[0.18.0]: https://github.com/robert-dean/deadair/compare/v0.17.1...v0.18.0
[0.17.1]: https://github.com/robert-dean/deadair/compare/v0.17.0...v0.17.1
[0.17.0]: https://github.com/robert-dean/deadair/compare/v0.16.0...v0.17.0
[0.16.0]: https://github.com/robert-dean/deadair/compare/v0.15.0...v0.16.0
[0.15.0]: https://github.com/robert-dean/deadair/compare/v0.14.0...v0.15.0
[0.14.0]: https://github.com/robert-dean/deadair/compare/v0.13.3...v0.14.0
[0.13.3]: https://github.com/robert-dean/deadair/compare/v0.13.2...v0.13.3
[0.13.2]: https://github.com/robert-dean/deadair/compare/v0.13.1...v0.13.2
[0.13.1]: https://github.com/robert-dean/deadair/compare/v0.13.0...v0.13.1
[0.13.0]: https://github.com/robert-dean/deadair/compare/v0.12.3...v0.13.0
[0.12.3]: https://github.com/robert-dean/deadair/compare/v0.12.2...v0.12.3
[0.12.2]: https://github.com/robert-dean/deadair/compare/v0.12.1...v0.12.2
[0.12.1]: https://github.com/robert-dean/deadair/compare/v0.12.0...v0.12.1
[0.12.0]: https://github.com/robert-dean/deadair/compare/v0.11.1...v0.12.0
[0.11.1]: https://github.com/robert-dean/deadair/compare/v0.11.0...v0.11.1
[0.11.0]: https://github.com/robert-dean/deadair/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/robert-dean/deadair/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/robert-dean/deadair/compare/v0.8.3...v0.9.0
[0.8.3]: https://github.com/robert-dean/deadair/compare/v0.8.2...v0.8.3
[0.8.2]: https://github.com/robert-dean/deadair/compare/v0.8.1...v0.8.2
[0.8.1]: https://github.com/robert-dean/deadair/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/robert-dean/deadair/compare/v0.7.1...v0.8.0
[0.7.1]: https://github.com/robert-dean/deadair/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/robert-dean/deadair/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/robert-dean/deadair/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/robert-dean/deadair/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/robert-dean/deadair/compare/v0.4.2...v0.5.0
[0.4.2]: https://github.com/robert-dean/deadair/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/robert-dean/deadair/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/robert-dean/deadair/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/robert-dean/deadair/compare/v0.2.4...v0.3.0
[0.2.4]: https://github.com/robert-dean/deadair/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/robert-dean/deadair/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/robert-dean/deadair/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/robert-dean/deadair/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/robert-dean/deadair/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/robert-dean/deadair/releases/tag/v0.1.0
