---
title: Run it from a Stream Deck
description: Put what is on air, Skip, Stop and your opinion of the record under your fingers, on an Elgato Stream Deck, with an API key rather than your password.
---

# Run it from a Stream Deck

By the end of this page an Elgato Stream Deck shows the cover of what is on air, and has keys to skip
it, like or dislike it, and stop or start the station. The Stream Deck never plays the station: it is
the desk, as keys.

[On a Stream Deck](../features/console.md#on-a-stream-deck) describes every key in full.

**You need** a Stream Deck, the Stream Deck app 7.1 or later on macOS or Windows, and to be signed in
to the console as an admin.

## 1. Install the plugin

Install **deadair** from [the Elgato Marketplace](https://marketplace.elgato.com/product/deadair-67841f42-616f-45f3-9708-341017359656).
The Stream Deck app keeps it up to date from there.

If you would rather open the file yourself, download `radio.deadair.streamdeck.streamDeckPlugin`
from [the latest Stream Deck release](https://github.com/robert-dean/deadair/releases?q=streamdeck)
and open it.

The deadair keys appear in the Stream Deck app's list of actions, under **deadair**.

## 2. Make an API key

The keys talk to the station with an API key, never your password.

1. In the console, open **Settings → Sign-in and security** and find **API keys**.
2. Under **New key**, name it for what will use it: `Stream Deck`.
3. Choose its access. **Read only** is enough for Now playing alone. Skip, Like, Dislike and Stop
   need **Read and manage**.
4. Choose when it expires, or **Never**.
5. Press **Create key**, and copy the key. The station shows it once and keeps only a fingerprint, so
   it can never show it again. It starts with `da_`.

## 3. Put the keys on the Stream Deck

1. Drag **Now playing** onto a key.
2. In its settings, under **Every deadair key**, enter the station's address under **Station**, such
   as `radio.example.com`, and paste the key under **API key**. An address with no `http://` or
   `https://` is taken as `https://`, so a station on your own network needs it written out:
   `http://192.168.1.10:8080`.
3. Press **Test connection**. It names the station that answered, or says what is wrong.
4. Drag **Skip**, **Like**, **Dislike** and **Stop or start** onto keys beside it. Every deadair key
   shares the address and the API key, so you enter them once.

The API key stays on that computer. It is never written into a Stream Deck profile you export, so a
shared profile does not share access to your station.

## 4. Use it

- **Now playing** shows the cover, the title and the artist, with a bar along the top that fills as
  the record plays, red while the station is on air. Press it to open the console. Under **This key**
  in its settings, a key can leave out the bar, or the words, for one that is only the cover.
- **Skip** ends the record or break on air.
- **Like** and **Dislike** set what the station thinks of the record on air, the same rating as
  everywhere else. The heart fills when the station already agrees: press the lit key to take the
  opinion back. A dislike keeps the record off the air for good.
- **Stop or start**: press once and it says _Confirm_, press again within five seconds and the
  station stops. Leave it and it forgets. Once stopped, the same key starts it.

With nothing to rate, such as during a break, Like and Dislike go faint and do nothing.

## If it goes wrong

- **A key says _No station_.** Open its settings and enter the address and the API key, then press
  **Test connection**.
- **A key says _Key refused_.** The API key was mistyped, revoked, or has expired. Make a new one in
  the console and paste it in.
- **Skip or Stop does nothing, and Now playing works.** The key is **Read only**. Make one with **Read
  and manage**.
- **Test connection cannot find the station.** The computer the Stream Deck is plugged into has to
  reach the station's address. Try it in that computer's browser.
- **The cover looks faint.** The key cannot reach the station right now, and is showing the last cover
  it had so nothing looks current when it is not.

## Next

- [Run the station from your phone](./phone-remote.md), for the rest of the desk away from the
  console.
- [Keep records off the air](./house-rules.md), for what a dislike does and the rules that go further.
