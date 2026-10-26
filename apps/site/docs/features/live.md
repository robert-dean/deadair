---
title: Going live
sidebar_position: 11.5
description: Taking the air from the station yourself, from an encoder on another machine, with a countdown on the Desk and the station's own programme stepping aside until you hand back.
---

You can take the air from the station whenever you like. Point an encoder on another machine at the station's **live input**, press **Go live** on the Desk, and start talking. A three-second countdown runs, then you are on the air for everybody listening. Hand back, or simply stop sending, and the station carries on from the next record in its running order.

## Going live

The **Live** card sits on the Desk, under On air now.

1. Type a **show name** if you want one. Listeners see it as the title of what is on while you are live, and the station's own name if you leave it empty.
2. Press **Go live**. Nothing changes yet: the input is armed and waiting for you.
3. Start sending from your encoder. As soon as the station hears real sound, the card counts you in: **3, 2, 1**. What you send during the countdown is not aired, so wait for it and start talking on the cut.
4. You are on the air. The card says so, with how long you have been on.

Connecting an encoder does nothing on its own, and an armed input waits for real sound rather than a connection: an encoder left running, or one sending silence, never takes the air.

## Handing back

Any of these gives the air back to the station:

- **Hand back** on the Live card. It asks for a second press, like Stop, because it cuts you off for everybody listening.
- Going quiet, or disconnecting, for **eight seconds**.

Either way the input disarms, so going live again is a fresh press of Go live. An encoder you leave connected after the show cannot take the air back by itself.

## What the station does while you are live

That is a setting, **Settings → Playout → While somebody is live, the station's own programme**:

- **Stops, and picks up at the next record afterwards** (the default). Nothing of the station's goes on underneath you: no records, no breaks, no news, and nothing is logged as played that nobody heard. When you hand back, the station carries on with the same running order from its next record, after a second or two of quiet while that record starts.
- **Carries on underneath, unheard.** The running order keeps moving through your show, so it is further along afterwards and its history includes what played while you were on.

If you press Stop on the station while you are live, it stays stopped when your show ends. Event destinations are not told the station went off air for a live show, because to a listener it never did.

## Connecting an encoder

Open **Connection details for your encoder** on the Live card. It shows everything an encoder asks for, each with a copy button:

| Field    | Value                                                                                 |
| -------- | ------------------------------------------------------------------------------------- |
| Server   | the address you reach the station at, as on the card                                  |
| Port     | `8006`, unless you mapped it to another port on the host (see below)                  |
| Mount    | `/live` (some encoders want it without the slash: `live`)                             |
| User     | `source`. The input accepts any user name, so this matters only if your encoder asks |
| Password | the one the card shows. The station made it when it was first set up                 |

Any encoder that speaks the Icecast source protocol works. Send MP3 or Ogg, at whatever level you want listeners to hear: the station does not level your audio, though it does catch peaks.

- **BUTT**: add a server of type **Icecast**, with the address, port, mount and password above.
- **Mixxx**: **Preferences → Live Broadcasting**, type **Icecast 2**, the same four fields.
- **OBS**: OBS has no Icecast output of its own, so record to a **custom output (FFmpeg)** pointed at `icecast://source:PASSWORD@ADDRESS:8006/live`, with MP3 as the audio codec and container.

Or straight from a terminal, to test:

```bash
ffmpeg -re -i show.mp3 -c:a libmp3lame -b:a 192k -content_type audio/mpeg -f mp3 icecast://source:PASSWORD@ADDRESS:8006/live
```

There is a little delay: listeners hear you about two seconds after you speak, which is the station's buffer between your encoder and the stream.

## Reaching the live input

The live input is its own port, **8006**, because it is not HTTP and cannot share the console's.

- **Unraid**: the template has a **Live input** port, set to `8006`. If you change the host side, use your number in the encoder.
- **Docker Compose**: the install maps it with `LIVE_PORT` in `.env`, `8006` unless you change it.
- **Over Tailscale** or another VPN, use the station host's address on that network, with the same port.

It is safe to leave published on your network: nothing on it airs until somebody presses Go live on the Desk, and only with the password. Do not forward it to the internet unless you mean anybody holding that password to be able to take the air once you have armed it.
