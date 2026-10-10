---
title: Make a voice
description: Giving a character a voice of its own, designed with Claude and ElevenLabs and cloned into Rhapsode, then wired to the character in three names.
---

Every character ships with a voice, but the stock voices are somebody's guess at what a character
sounds like. This page makes one that fits: design it from a description, clone it into the speech
server, and point the character at it. The example uses [Rhapsode](https://rhapsode.dev/)
with its Chatterbox engine, which clones from a short clip, and ElevenLabs connected to Claude for the
design. Any engine that clones from a clip works the same way. Only the upload step changes.

## Three names

A character never names a sound file. It names a **station voice**, and the speech plugin's Voices
table says what that name is on its engine:

| Where | What it holds | Example |
| --- | --- | --- |
| The character's **Voice** (Voice → Characters, edit) | a station voice name | `latenight` |
| Rhapsode's **Voices** table (Settings → Plugins → Rhapsode) | that name, an engine and an engine voice | `latenight`, `chatterbox`, `latenight` |
| The Rhapsode server | the cloned voice and its reference clip | `latenight` |

Every built-in character's Voice is already its own key (`classic`, `latenight`, `countdown` and so
on). Use the same word all three times, the character's key, and the wiring is one table row. Breaking
that rule is allowed, but it is the first thing to check when a character speaks in the wrong voice.

## Designing it

In Claude, with the ElevenLabs connector added, ask it to design a voice. It needs two things from you:

- **A description.** Work from the character's own sheet: how they talk, where they are from, how old
  they are, what they sound like at three in the morning. Describe an adult. A description of a
  child's voice is refused, and "a young man, around nineteen" gets a young voice where "a teenage
  boy" does not.
- **A line for it to speak**, at least a hundred characters. Write it in the character's manner, or
  take one from their phrasings, because the clip is the whole of what the clone learns from: a voice
  read flat in the design is flat on air.

ElevenLabs answers with a few previews of 13 to 15 seconds each. Listen to them all and pick one.

Use **Voice Design**, which invents a voice, and not a voice from ElevenLabs' library: those are
recordings of real people, licensed to that marketplace, and cloning one onto your station is
cloning a person. For the same reason, don't name a real singer or presenter in the description.
Describe the manner you want instead. Check that your ElevenLabs plan lets you use what it generates
in the way you mean to.

If the station speaks through the [ElevenLabs plugin](../features/models-and-voices.md#voices), there is nothing to clone.
Save the preview you picked to your ElevenLabs account, and it appears by name in that plugin's Voices table.
Give it the character's voice name there and skip to [wiring it to the character](#wiring-it-to-the-character).

### What survives cloning

A designed voice is cloned a second time when it reaches your server, and not every voice comes
through it. **Breathy, whispery and husky designs come out thin**, with the low end gone and too much
upper midrange: it sounds like the character is on the phone. Ask for a **full, clear, chest-resonant
voice**, "clear rather than whispery", and they clone with their body intact. If two previews sound
equally right, the fuller one will sound better on air.

## Cloning it into Rhapsode

The preview you picked is already the right length for Chatterbox, which takes a reference of about
5 to 20 seconds. Download its audio, and keep the line it speaks: that is the transcript.

Creating a voice writes a file on the Rhapsode server, so Rhapsode treats it as a management route
and answers it only from the server's own machine, or from anywhere with its management token. The
simplest way is Rhapsode's own page: under **Try it**, choose Chatterbox and clone from the clip. From
another machine, with `management.token` set in `rhapsode.config.json`:

```bash
curl -X POST https://rhapsode.example.com/engines/chatterbox/voices \
  -H "Authorization: Bearer $RHAPSODE_TOKEN" \
  -F id=latenight \
  -F label="Sonny, late nights" \
  -F transcript="The words spoken in the clip, exactly as they are spoken." \
  -F reference=@latenight.mp3
```

A `201` answers with the new voice, including a `spec`. Ask
`GET /engines/chatterbox/voices/latenight/preview` for a short sample.

**Keep the clip.** Rhapsode has no way to give a reference back, and its preview is a few seconds
long, too short to clone from. If you ever want this voice again after replacing it, your copy is the
only one.

## Wiring it to the character

Under **Settings → Plugins → Rhapsode**, add a row to **Voices**: Station voice `latenight`, Engine
`chatterbox`, Engine voice `latenight`. The engine voice cell offers what the server reports; a voice
cloned a moment ago may need a refresh to appear, and can be typed in the meantime. Leave **Variant**
empty to use whichever Chatterbox model the server has loaded, or name one (`turbo`, `original`,
`multilingual`). Turbo performs laughs and sighs; the other two have dials for how theatrical a voice
is, and no build does both.

If the character's **Voice** is already `latenight`, that is all. Otherwise set it on the character.
**Voice → Voices** plays a sample of every station voice through the same path a break airs on, so
listen there with a line that is not the one in the clip, which tests the clone rather than replaying
its reference. The next break the character writes is in the new voice.

## Changing it later

Cloning to the same id again replaces the voice, and its `spec` changes to say so. Nothing on the
station needs to change: the next thing it speaks in that voice is the new one.

## If it goes wrong

- **The clone answers `403 forbidden`.** It came from another machine without the management token,
  or from a web page whose origin Rhapsode does not trust. Use the token, or Rhapsode's own page.
- **It sounds like a telephone.** The design was breathy or whispery. Design again and ask for a full,
  clear voice.
- **The character speaks in the plugin's default voice.** Check the three names. A character whose
  Voice has no row in the table falls back to the default, and the station's log says "no mapping
  for this voice" when it does.
- **The character has gone quiet, and the sample on Voice → Voices fails.** The row names an engine
  voice the server does not have, so Rhapsode refuses it and the break is skipped rather than aired
  late. Check the id against `GET /engines/chatterbox/voices`.
