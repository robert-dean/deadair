# Running deadair

One container: the station, its console, the audio chain, the stream server and the measurement
sidecar. One volume. The stream comes out of the same port the console does, so whatever you put
in front of that port carries the station too.

## Which tag

| Tag                      | Brings                     | Bring your own                     |
| ------------------------ | -------------------------- | ---------------------------------- |
| `deadair/deadair:latest` | a voice                    | PostgreSQL, Redis                  |
| `deadair/deadair:full`   | a voice, PostgreSQL, Redis | nothing                            |
| `deadair/deadair:slim`   | —                          | PostgreSQL, Redis, a speech server |

Those three follow `main` and move on every push. A release publishes `0.1.0` and `0.1` beside
them, so **pin `deadair/deadair:0.1` if you want releases only**. Images are built for `linux/amd64`;
there is no arm64 build yet.

`full` is the one to start with if the machine has nothing on it. `latest` is the one to run if
the machine already has a database you keep backups of, which is the better place for this
station's to live. `slim` is for pointing the speech plugin at a machine with a graphics card in
it; the voice is the one part of this that genuinely wants one.

## Before the first start

Two secrets, generated once and kept:

```bash
openssl rand -hex 32
```

That is `KMS_LOCAL_ROOT_KEY`, and it encrypts every credential the station stores — your music
provider's tokens, the stream's own passwords. Losing it means entering all of them again. It has
to be hex: the station reads it as hex bytes, so a base64 key of the same length is quietly a
different and much weaker key than you meant to generate.

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 | base64 -w0
```

That is `AUTHENTICATION_SESSION_JWT_PRIVATE_KEY`, and it signs sessions. It must be RSA, because
sessions are signed RS256. Losing it signs everybody out and costs nothing else.

The `base64` is there because a key is several lines and nearly every field you might paste one
into holds a single line — a container template's variable box, an environment file, a secrets
form. The station accepts the key three ways (the PEM as it comes out, the PEM with its line
breaks written as `\n`, or base64-ed onto one line), so if you already have one in another shape
it will work; base64 is simply the shape that survives everything. On macOS the flag is `base64`
with no `-w0`.

If you are not using the `full` tag, you also need a PostgreSQL database that already exists (the
station creates its own schema inside it, not the database itself) and a Redis to put sessions in.

## On Unraid

Install the template in `unraid/deadair.xml`, fill in the fields, start it. The data path defaults
to `/mnt/user/appdata/deadair` and everything the station keeps goes there.

There is no ownership step: the container runs as 99:100, which is what an appdata share is owned
by, so it can write to the volume as it stands.

## Anywhere else

`docker-compose.yml` here is the same container described for Compose. Copy `.env.example` to
`.env`, fill it in, and:

```bash
docker compose up -d
```

On a host whose data directory is not already owned by 99:100, give it to the station once:

```bash
sudo chown -R 99:100 ./data
```

## The first boot

The schema is applied before the station starts, every time, so there is no migration step to run.

Open the console on the port you published and sign in. Then, in order of what actually stops the
station being a station:

1. **A music provider.** Plugins page: enter the provider's credentials and let the library sync.
   Nothing can be programmed until there are records to program.
2. **Playback authorization, if that provider is Spotify.** Same page, the card below the
   connection. This is a **second** credential and it is easy to think it is the same one: the
   connection lets the plugin read your library, and this lets the station fetch the audio. With
   only the first, the console lists your playlists perfectly and every record is dropped for want
   of audio. It takes one browser visit and holds indefinitely.

   The page Spotify sends your browser to **will not load**, and that is expected rather than the
   step failing. It is an address on the station itself, which your browser cannot reach; copy it
   out of the address bar and paste it back into the console, which finishes the job. The card
   walks you through it.
3. **The stream's own settings.** Stream page: a station name, and the public address listeners
   reach it at. Saving these is what renders the stream server's configuration for the first time
   and takes the audio chain off its built-in defaults.
4. **The presenter.** Personas page: pick who is on air. There are several to start from.
5. **A model, if you want one.** Plugins page: the station writes what the presenter says with a
   local or hosted model when one is configured, and from its own phrasings when none is. It is
   not required, and a station with none still talks.
6. **Where the station is.** Settings page: an IANA zone name. It is what the presenter reads the
   clock in, and — less obviously — what decides whether it is morning or evening where a listener
   is. Left unanswered the station falls back to the container's `TZ`, which is UTC unless you set
   it, and a presenter four hours out says "tonight" through your afternoon. Set the setting rather
   than the variable where the two disagree: a station is a place and its listeners are in it,
   which is not necessarily where the server is.

Two things need a browser visit rather than a setting, and both are on the plugins page: the music
provider's authorization, and — on Spotify — the station's own playback authorization above. Nothing
else does.

Nothing here needs a URL pointing at another container. The parts of the station address each
other inside the container, and the speech and measurement plugins are already looking at the
right place.

## Putting it on the internet

Publish the one port through whatever you already use — a reverse proxy or a tunnel. It carries
the console, the API and `/live.mp3`, which is the stream itself. Terminate TLS out there; the
container speaks plain HTTP and trusts the forwarded headers.

The mount is not authenticated. Anybody who can reach that address can listen, which for a radio
station is usually the point, but it is worth knowing before you publish it.

## Two kinds of thing, and two disks

Everything above keeps one directory, which is right until the library gets big. But the station
keeps two kinds of thing and they want different treatment:

| | What it holds | Wants |
| --- | --- | --- |
| `/data` | settings, presenters, the schedule, pronunciations, ratings, installed plugins, the stream's credentials, audio you recorded yourself, logs, and on `full` the database | fast storage, and your backups |
| `/media` | records downloaded before they air, cover art, rendered speech, voice previews, the speech model's weights | bulk storage, and no backup |

The second is entirely derived: every file in it can be produced again by running the station, and
it grows to roughly the size of the library you actually play. The first is what somebody
authored, and it stays small.

Mount something at `/media` and the derived half goes there:

```
-v /mnt/user/media/deadair:/media
```

On Unraid that is the **Media** field in the template; leave it blank and everything stays under
`/data`, exactly as before.

The station decides by whether `/media` is really mounted, not by a setting you also have to
change. That is deliberate: a path and a variable that must agree can disagree, and the way they
would disagree here is the expensive one — the station writing a whole library into the
container's own filesystem, which on a home server means quietly filling the disk image every
container shares.

`playout.trackCacheMaxBytes` puts a ceiling on the record cache if the disk it lives on has one.

Two things sit on the authored side that look like they belong with the media, and do not: the
audio an operator drops in for the station to take in (`/data/inbox`), and any voice clip added by
hand (`/data/voices`). Nothing regenerates those.

`/data/streamhls` is the opposite of all of it and wants no thought at all: it holds the last few
seconds of HLS segments while `stream.hlsEnabled` is on, is rewritten continuously, and is bounded
by the segment settings. Losing it costs a listener one reconnect. It is in `/data` because
Liquidsoap writes it and nginx serves it, and both of those live here.

## Upgrading

Pull the new image and bring the stack back up:

```bash
docker compose pull
docker compose up -d
```

On Unraid, the template checks for a new image and the update is a button.

The schema looks after itself: migrations are applied before the station starts, so a new one is
picked up on the next boot and there is nothing to run by hand.

**Which tag you are on decides what you get.** `latest`, `slim` and `full` follow `main`, so pulling
one gets you whatever was last merged. Pinning `0.1` gets you releases on that line and nothing
else, and the release notes for each are in the repository's `CHANGELOG.md`. If you want a station
that only changes when you decide it does, pin the exact version.

**From 0.1.0 onward a migration is added, never edited.** Before the first release this project
edited them in place, which is right when the only database in the world is the author's and wrong
the moment somebody else has one: dbmate tracks versions rather than checksums, so an edited file is
silently not re-applied on a database that already ran it. If a release ever does need a step run by
hand, that step is in the changelog entry for that version, and it says so there rather than living
here forever.

## Backing it up

The data directory, and — if your database is elsewhere — a dump of it. Not the media directory. Between them they hold
everything that was authored rather than fetched: the settings, the presenters, the schedule, the
pronunciations, your ratings, and any audio you dropped in yourself. The rest (the library's
metadata, its cached audio, artwork, measurements, rendered speech) is regenerated by running the
station again.
