---
title: Help
sidebar_position: 4
description: The usual ways a station ends up silent, locked out or unable to send mail, and what the console says about each.
---

# Help

The station is built to answer most of this itself: **Check-up**, at the foot of the console's
navigation, says what is wrong right now in one sentence, and **Why is it not on air?** on the Desk
opens every gate that can silence it. This page is the handful of causes that come up most, and the
two or three that need a shell rather than a page.

## It is silent

**Most often, on purpose.** By default a station airs only while somebody is listening: a full
running order with an empty mount is quiet deliberately, because producing audio costs a fetch and a
download per record. The console calls this **ready** rather than a fault, and the station stays on
air for five minutes after the last listener leaves in case they come back. Open the stream and it
starts. Under **Settings → Playout** you can have it air whenever there is a running order instead.

**Having the console open is not listening.** The console deliberately does not play the mount.

If it is still quiet, Check-up names the gate. Eleven of them are judged in order, and the first that
blocks is the answer, because a gate upstream makes everything below it unreadable rather than merely
also wrong. The usual ones:

- **Nothing to air.** The running order is empty. Press **Plan** on the Desk, or check the library
  has records in it.
- **Still fetching.** A record is not committed to air until its audio is on the machine. A station
  whose first downloads are in flight is working, not broken.
- **The audio chain cannot be reached, or refuses the station's commands.** Check the containers are
  up. The verdict carries the remedy, with a copy button when it is a command the station cannot run
  itself.
- **Config not adopted.** The audio chain is running settings the station has since replaced. A
  station can air perfectly well while this is true, but it is why the next attempt to go on air
  fails. It is reported and never given as the cause.

## Every record is dropped, and the playlists look fine

**On Spotify, there are two authorizations and you need both.** The connection lets the plugin read
your library; the playback authorization, on the card below it under **Settings → Plugins**, lets the
station fetch audio. With only the first, everything lists perfectly and nothing can be played.

The page Spotify sends your browser to will not load, and that is expected rather than the step
failing: it is an address on the station itself. Copy it out of the address bar and paste it back
into the console, which finishes the job.

## The listener count is wrong

Behind a reverse proxy or a tunnel, every listener arrives from the proxy's address unless the
container is told which proxy to trust, through `REAL_IP_FROM` ("Proxy in front" on Unraid). Without
it the count can be wrong in both directions, which matters because the count is what holds an
audience-gated station on air.

A program that fetches the stream around the clock keeps such a station on air for nobody.
**Players the station will not serve**, under Settings → Stream, takes a list of user-agent names
such as `Go-http-client` and refuses them without counting them.

## Mail will not send

**"Unable to verify the first certificate"** is a self-signed certificate, or one from your own
certificate authority. Turn off **Check the server's certificate** under **Settings → Mail** for that
server. Off, the station accepts any certificate at all, so keep it on for a server reached across
the internet.

**Until a mail server is set, the station sends nothing and says so.** It will not offer an emailed
code it cannot deliver, so a station with no mail configured signs you in on the password alone. That
is deliberate: the alternative is a fresh install asking for a code it cannot send, on the account
that would have configured the sending.

## You have lost your authenticator

With a mail server configured you do not need this: ask for a sign-in link, or sign in with the
password and take the emailed code as the second factor.

With no mail either, this is the way in, from the box, against the station's database:

```sql
update deadair.actors_authenticator_factors set active = false;
```

Then clear the sessions, which live in Redis rather than the database:

```bash
redis-cli FLUSHALL
```

If your Redis asks for a password, `redis-cli -u "$REDIS_URL" FLUSHALL`, or `-a` with the password
you gave `REDIS_PASSWORD`. That turns the challenge off for every account on the station, since there
is one. Sign in with the password, and enrol the new phone from **Settings → Security**.

A sign-in link is worth one warning: it is the whole of the sign-in, so anybody who can read that
message can get in. It works once, it expires in half an hour, and it should not be forwarded.

## Where to look, and where to ask

- **Check-up → Machinery** is every part as it stands: the verdict, the listener count, the loops,
  the plugins, how many records are held, the disk and the build.
- **Check-up → What it has been doing** is what aired and what failed, as a list of moments rather
  than a log file.
- **Check-up → Logs** is what the processes themselves wrote, the station's and the audio chain's.
- **Voice → What it said** is every break the station wrote and every one it declined, with the
  reason.

Nothing left? [Q&A discussions](https://github.com/robert-dean/deadair/discussions/categories/q-a) is
the place to ask, and [issues](https://github.com/robert-dean/deadair/issues) the place for a bug.
Security problems go through a private advisory rather than either.
