<p align="center">
  <img src="apps/web/public/logo.png" alt="deadair" width="280">
</p>

# deadair

**An AI radio station you run yourself.** It picks the records, writes what the presenter says
between them, speaks it in that presenter's voice, and streams the result. One mount, one running
order, everybody hears the same thing at the same moment.

It is a radio station rather than a playlist. There is no per-listener shuffle and no skip button:
what is on is what is on, and the station decides.

**[deadair.radio](https://deadair.radio)** is the website: the install guide, the music licensing
notes and the API reference, with the API also described as an OpenAPI 3.1 document at
[deadair.radio/openapi.yaml](https://deadair.radio/openapi.yaml) for anyone generating a client.

> **It plays your music, not its own.** deadair holds no catalogue. It programmes what your provider
> already gives you — a Spotify account or a Subsonic server such as Navidrome — and it grants you no
> rights to broadcast any of it. Read [docs/licensing.md](docs/licensing.md) before you publish an
> address.

---

## What it actually does

**It keeps a running order, and one thing owns it.** Not a queue that gets topped up: a forward
lineup you can see and edit, several hours deep, where every item carries its own state. The
director is the only writer of it, and the console, the schedule and the model all post commands to
it rather than writing it themselves. That is what makes an edit at 3pm still true at 3.05.

**It talks between records, and it cannot be made silent by a model.** A break is written by whoever
is presenting: a local or hosted model when one is configured, and the station's own phrasings when
none is, when the model is slow, or when what it wrote failed a check. The floor cannot fail, which
is the whole design — a station whose presenter went quiet because a GPU was busy is not a station.

**It says things that are true, or it says nothing.** When the presenter mentions a fact about a
record, that fact is a stored claim with the sentence of source prose that supports it, and a claim
with no source is not expressible in the schema. The alternative is a presenter saying something
specific, checkable and untrue in exactly the voice it uses for things that are true.

**Who is presenting is a row, and it accumulates.** A persona carries a voice, a diction, how much
rope it is given and how brief it is. It keeps a notebook of things it has said and traits it is
growing into, and a set of anecdotes it can tell on air. It can take a phone-in: a produced block in
the middle of a broadcast where a caller and the host trade turns, each one its own model call in its
own voice, joined into one file before it airs.

**It knows what it is playing.** A measurement sidecar decodes each record and answers with its cue
points and its loudness, so the silence at the head and tail of a record is trimmed before the player
sees it and boundaries are sized from what the material actually does. No decoding happens in Node.

**It says why it is quiet.** Eleven ordered gates over one snapshot answer "why is nothing playing"
with a single causal verdict rather than three partial inferences, and the answer is written to the
station's own event log, so "why was it silent at three in the morning" is a question with an answer.

## How it fits together

```
                  your provider                    a model             a voice
              (Spotify / Navidrome)             (local or hosted)   (Kokoro / Chatterbox)
                       │                               │                    │
                       └───────────── plugins ─────────┴────────────────────┘
                                         │
    ┌────────────────────────────────────┴─────────────────────────────────┐
    │  the station (Node)                                                  │
    │    director ── one running order, and the only thing that writes it  │
    │    render   ── words, then audio, one state per stage                │
    │    playout  ── hands records over, one at a time, and holds a lease  │
    └────────────────────────────────────┬─────────────────────────────────┘
                                         │  HTTP
                  ┌──────────────────────┼──────────────────────┐
             Liquidsoap              PostgreSQL              analysis
          (mixing, on air)        (everything kept)      (cue points, loudness)
                  │
               Icecast ──────────────►  /live.mp3  (plus Opus/AAC/FLAC and HLS, opt-in)
```

Audio never touches Node in the sense that matters: nothing here decodes, mixes or encodes. The
mixing chain and the stream server run beside the station, and the station drives them over HTTP.

**The mount is leased, not held.** Liquidsoap airs nothing unless the station is actively renewing a
short claim, so a crashed or redeployed station takes itself off the air within seconds rather than
leaving a music bed playing to nobody's plan. And by default it airs only while somebody is
connected: a loaded station with a full running order and no listeners is silent on purpose, and the
console says so rather than reporting a fault.

## Running it

Everything is one container: the station, its console, the audio chain, the stream server and the
measurement sidecar. **[deploy/README.md](deploy/README.md) is the install guide** — which tag to
pull, the two secrets to generate first, the first-boot order, and the two-disk layout for a big
library.

| Tag | Brings | You bring |
| --- | --- | --- |
| `deadair/deadair:latest` | a voice | PostgreSQL, Redis |
| `deadair/deadair:full` | a voice, PostgreSQL, Redis | nothing |
| `deadair/deadair:slim` | — | PostgreSQL, Redis, a speech server |

Those three tags follow `main`, so they move on every push that changes the station; a push that
touches only the docs, the website or a listener app leaves them where they are. A release publishes
`0.1.0` and `0.1` alongside them, once its tests pass, and is tagged `v0.1.0` with a GitHub release
of its changelog entry: **pin `deadair/deadair:0.1` to track releases only**, and read
[CHANGELOG.md](CHANGELOG.md) for what changed between them. How a release is cut is in
[CONTRIBUTING.md](CONTRIBUTING.md). Images are `linux/amd64`.

On Unraid, install the template in [`unraid/deadair.xml`](unraid/deadair.xml). Anywhere else,
[`deploy/docker-compose.yml`](deploy/docker-compose.yml) is the same container written for Compose.
One published port carries the console, the API and the stream, so whatever you already put in front
of a port carries the station too.

**One thing to know before you start**, because it is the most common way to end up with a station
that looks perfect and plays nothing: on Spotify there are **two** authorizations and you need both.
The connection lets the plugin read your library; the playback authorization below it lets the
station fetch audio. With only the first, your playlists list correctly and every record is dropped.

## The console

A broadcast desk rather than a player. It deliberately does not play the mount: the listener surface
is the mount itself, plus the Android app (`apps/android`) and the desktop app (`apps/desktop`) if
you build and run either one.

A rail down the left carries four destinations, with a key each: D, P, L and V. **Desk** is the
running order, live, with the playhead, every item's state and whatever needs you. **Programme** is
Today, the Timetable across the week, and Sustaining, which is what plays when nothing is scheduled.
**Library** is Tracks, Artists, Playlists, Charts and News. **Voice** is who the station is when it
talks and how it says things: Characters, Auditions, Voices, Segments, Pronunciations, Soundboard,
Subjects, Productions, and What it said, which is every break it has written and every one it
declined. Below a rule sit **Check-up** and **Settings**. Check-up is what is wrong right now:
Machinery for every part as it stands, What it has been doing for what aired and what failed, What it
cost for every call the station made, and Logs for what the processes themselves wrote.

**Settings → Security** is how you sign in. Enrol an authenticator app there (Google Authenticator,
1Password, Aegis, anything that shows six-digit codes) and from then on every sign-in to that
account asks for the code after the password. Remove it and sign-in goes back to the password
alone. Either change asks for a fresh code first if the one you signed in with is more than a few
minutes old.

**Settings → Mail** is what makes the other half work. Point it at any SMTP server and the station
can send a sign-in code to your email address as a second factor, and a sign-in link as a first one
— "Email me a sign-in link" on the sign-in page, no password at all. Until a mail server is set the
station sends nothing, and it says so plainly rather than failing quietly: it will not offer you an
emailed code it cannot deliver, so a station with no mail configured signs you in on the password
alone. That is deliberate. The alternative is arriving at a fresh install that asks for a code it
cannot send, on the account that would have configured the sending.

A sign-in link is worth one warning: **it is the whole of the sign-in**, so anybody who can read
that message can get in. It works once, it expires in half an hour, and it should not be forwarded.
An account with an authenticator enrolled is still asked for the code afterwards — a link proves
the inbox, which is one factor and not two.

### If you lose your authenticator

If you have a mail server configured, you do not need this: ask for a sign-in link, or sign in with
the password and take the emailed code as the second factor. This is the way in when there is no
mail either. From the box, against the station's database:

```sql
update deadair.actors_authenticator_factors set active = false;
```

then clear the sessions, which live in Redis rather than the database:

```bash
redis-cli FLUSHALL
```

(`pnpm flush:sessions` in a development checkout.) That turns the challenge off for every account
on the station, since there is one. Sign in with the password, and enrol the new phone from
Security.

## Configuration

Almost none of it is environment variables. `.env` holds boot and infrastructure — where the
database is, the key that encrypts stored credentials, the key that signs sessions — and everything
else is a row in the database, edited from the Settings page and applied live. A setting changed in
`psql` reaches a running station without a restart.

Plugins carry their own configuration, declared by the plugin and drawn by the same form the
station's own settings use.

The model plugin is worth one note, because it is the only place a name means more than it looks. It
speaks to OpenAI-compatible servers (a local Ollama or vLLM, or OpenAI, Groq, Mistral and OpenRouter
by address), to Anthropic and to Gemini, and it speaks to **as many at once as you add** — each one a
row in a table, with whatever name you give it. That name is how a model is addressed: a model on the
row you called `ollama` is `ollama:gpt-oss`, and one on the row you called `claude` is
`claude:claude-sonnet-5`. Every job that asks a model for words has its own model setting under
Settings → Words, so a station can write its talk breaks on a hosted model and do its reading and
note-taking on a local one. Those settings offer what your providers actually have, so the names are
picked rather than typed.

An API key typed into that table is stored the way every other credential here is: encrypted, never
shown again, and never returned by the API.

## Development

```bash
pnpm install
docker compose up -d              # Postgres, Redis, Icecast, Liquidsoap, a voice, the sidecar, Mailpit
pnpm --filter @deadair/api migrate:up
pnpm dev
```

Node 26+, pnpm, Turborepo. `pnpm test`, `pnpm lint` and `pnpm build` run through turbo; per package,
`pnpm --filter @deadair/api test`.

Mailpit is in that stack so the sign-in flows can be walked end to end without a real mail server
and without a code leaving the machine: point Settings → Mail at `localhost`, port 1025, TLS off, no
username, any from address, and read what the station sent at <http://localhost:8025>. With it
configured, `OTP_DEV_BYPASS` is no longer needed to get through an email challenge — the code is in
the inbox.

```
apps/api               the station: Koa, ContractKit routers, dbmate migrations
apps/web               the console: React, Vite, TanStack Router, Mantine
apps/site              the website at deadair.radio: Docusaurus
packages/plugin-sdk    the plugin contract and the host capabilities
packages/sdk           a typed client, generated from the contracts
plugins/*              spotify, navidrome, musicbrainz, lastfm, wikipedia, rss,
                       websearch, weather, kokoro, chatterbox, llm, analyzer
examples/plugins/*     a plugin built from outside the workspace, as anybody else's is
analysis/              the measurement sidecar (Python): cue points and loudness
stream/, nginx/        the audio chain (radio.liq), the stream server and the edge
```

A station also loads plugins it did not ship with: `@deadair/plugin-sdk` is on npm, and how to write,
build and install one is at <https://deadair.radio/docs/plugin-development>.

Contracts, permission types and database types are **generated and committed**. Never hand-edit
them; CI regenerates all three and fails on anything that moved.

[`CLAUDE.md`](CLAUDE.md) is the deep reference: every non-obvious constraint, with the measured
failure behind it. Read the part covering whatever you are about to touch — most of those paragraphs
exist because the obvious fix was shipped first and was wrong. [`docs/internals/`](docs/internals)
holds the long-form arguments, one file per subsystem, and the
[Ideas](https://github.com/robert-dean/deadair/discussions/categories/ideas) discussions hold work
that was designed against the real tree and then deliberately deferred, which is worth reading
before designing a feature from scratch: the call may already have been made.

## Reporting something

Bugs and requests go to [the issue tracker](https://github.com/robert-dean/deadair/issues).
Anything security-shaped goes privately instead — [SECURITY.md](SECURITY.md) says how, and says what
the station assumes about where it runs, which is worth reading before you decide something is a
bug. [CONTRIBUTING.md](CONTRIBUTING.md) is how to build it and the handful of rules that will bounce
a change.

## Licence

[MIT](LICENSE), for the source in this repository.

That is not the whole picture for the published container image, which bundles Liquidsoap, Icecast,
go-librespot and — in the `full` variant — PostgreSQL and Redis, several of them copyleft.
[THIRD-PARTY.md](THIRD-PARTY.md) lists every one with its version and its terms.

And none of it is about the music, which is yours and is licensed by whoever licensed it to you:
see [docs/licensing.md](docs/licensing.md) before you publish an address.
