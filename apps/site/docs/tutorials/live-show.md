---
title: Do a live show
description: Connect an encoder, book a show on the timetable, take the air with a countdown, hand back to the station, and listen back to the recording.
---

# Do a live show

By the end of this page you have presented a show yourself. The station steps aside at the time you
booked, counts you in, records you while you are on, and carries on from its next record when you
hand back. Afterwards the show is an MP3 you can listen back to and download.

[Going live](../features/live.md) and [Recordings](../features/archive.md) explain each part in full.

**You need** a station on air, a microphone, and an encoder on the computer you will talk from:
[BUTT](https://danielnoethen.de/butt/) is free and simple, and Mixxx works if you want to play
records yourself. The computer has to reach the station's port `8006`.

## 1. Check the live input is reachable

The live input is its own port. On Unraid, the template's **Live input** port is `8006`; with Docker
Compose it is `LIVE_PORT` in `.env`. If you installed before live shows existed, add the port
to the container so it is published.

Open the **Desk**. Under **On air now** there is a **Live** card. No card means the station's audio
chain is older than live shows: update the station.

## 2. Keep a recording

Open **Settings → Stream** and set **Record what airs** to **Live shows only**. Leave **Keep
recordings for (days)** at 14, or set 0 to keep every show until you delete it. Save.

Saving restarts the audio engine, a few seconds of silence for anybody listening, so do it before
the show rather than during one.

## 3. Connect the encoder

On the Live card, open **Connection details for your encoder**. Copy each field into the encoder.
In BUTT, open **Settings**, and under **Main → Server** press **Add**:

| BUTT asks for | Put in                                               |
| ------------- | ---------------------------------------------------- |
| Type          | **Icecast**                                          |
| Address       | the **Server** from the card                         |
| Port          | `8006`, or the host port you mapped it to            |
| Password      | the **Password** from the card                       |
| IceCast mountpoint | `live`                                          |
| IceCast user  | `source`                                             |

Under **Audio**, pick your microphone, and choose MP3 at 192 kbps.

Press BUTT's play button to connect. Nothing airs: an input nobody has armed ignores whatever it is
sent. Disconnect again for now.

## 4. Book the show

Open **Programme → Specials** and press **New special**.

1. Name it `Friday Night Live`. Listeners see this as the title while you are on.
2. Set the date, and the start and end times, such as `21:00` to `22:00`. For a weekly show, give a
   range of dates and the day it runs on.
3. Switch on **A live show**. The programme fields go away, because nothing of the special's own
   plays.
4. Save.

The show is on the timetable marked **(live)** and on the Specials list with a **Live** badge. On the
day and the day before, the Desk's Live card names it and its time.

Before the show, check **Settings → Playout → While somebody is live, the station's own programme**.
The default, **Stops, and picks up at the next record afterwards**, is the usual choice: nothing of
the station's plays underneath you, and it carries on afterwards as if you had never interrupted.

## 5. Go on air

A few minutes before nine, connect BUTT again. At nine the station arms the input by itself, but
the weekly show keeps playing until it hears you.

Start talking, or play your opening record. As soon as the station hears real sound the Live card
counts **3, 2, 1**. What you send during the count is not aired, so wait for it and start on the
cut. Then you are on, and the card shows the red tally and how long you have been on air.

Listeners hear you about two seconds after you speak, so listen on headphones to the encoder, not
to the stream.

**Not booked?** Type a show name on the Live card and press **Go live** at any time. Everything after
that is the same.

## 6. Hand back

When you are done, press **Hand back** on the Live card, twice: it asks a second time, because it
cuts you off for everybody listening. Or simply stop sending: eight seconds of silence or a
disconnect hands back too.

The station picks up at the next record of its running order, after a second or two of quiet while
that record starts. Your booking's end time never cuts you off, so a show that runs long is fine.

## 7. Listen back

Open **Check-up → Recordings**. Tonight's show is at the top with its name and a **Live** badge.
**Play** opens a player you can skip around in, and **Download** saves the MP3 named after the date
and the show, ready for an editor.

## If it goes wrong

- **The countdown never starts.** The station is not hearing sound: check the encoder is connected
  (BUTT says so), the microphone is the one chosen under **Audio**, and its level moves. An encoder
  sending silence never takes the air.
- **The encoder cannot connect.** Check the address, the port and the mount (`live`, or `/live` for
  encoders that want the slash), and that port `8006` is published and reachable from your
  computer. A wrong password is refused.
- **Nine o'clock came and the card never armed.** Check the special has **A live show** on and is on
  today's date. If the audio engine restarted after the station armed it, the booking does not arm
  again that night: press **Go live** yourself.
- **Nobody came.** If the input is still waiting at the end time, the station disarms it and carries
  on. **Cancel** on the card does the same earlier.
- **No recording.** **Record what airs** was off while the show was on. Set it to **Live shows
  only** before the next one.

## Next

- [Going live](../features/live.md) for Mixxx, OBS and the rest of the encoder settings.
- [Recordings](../features/archive.md) to keep everything on air, and where the files are on disk.
- [Run it from a Stream Deck](./stream-deck.md) to keep the station under your fingers while you
  present.
