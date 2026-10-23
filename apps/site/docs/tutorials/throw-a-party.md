---
title: Throw a party
description: Let the room choose the music. Guests scan a code on the TV and ask for records from their phones, with no account and no app.
---

# Throw a party

By the end of this page the station is playing a request show, a code is up on a screen, and anybody
in the room can scan it and ask for a record from their phone. Nobody needs an account or an app. Each
guest asks one at a time, under the same rules as any listener, and the presenter reads out their
dedications.

[The programme](../features/programme.md#requests) explains requests, the rules and dedications in
full.

**You need** a station on air with music, and a screen the room can see: a TV, a projector, or a laptop
turned round. The guests' phones have to be able to reach the station, so on a home network they need
to be on its wifi, and on a station you have put on the internet they can be anywhere.

## 1. Put on a request show

On the **Desk**, press **Plan**, choose **Start a new show**, then press **Party night**.

Party night fills in a request show for a crowd: after each request the station plays three records
that sound like it, one guest waits ten minutes between requests, and ten can be waiting at once. Every
field stays yours to change. Write a brief if you want one, then press **Go on air**.

A request show is not required. Guests can ask on any show, and their requests land in the next gap
between records. What Party night adds is that each request steers what comes after it.

![The Plan dialog on Start a new show, with the Party night button under the brief](/img/console/desk.plan.webp)
*Fig. 1. **Plan → Start a new show** on the Desk. **Party night** is under the brief.*

## 2. Start a party

Open **Programme → Requests** and press **Start a party** at the top.

Choose how long the code works, in hours (six unless you change it, at most a day), and press
**Start a party**. The card now shows the code, when it stops working, and how many guests have joined.

![Programme, Requests: the party card and the list of open requests](/img/console/schedule.requests.webp)
*Fig. 2. **Programme → Requests** before a party has started.*

If the card warns that the code points at `localhost`, you opened the console on the station's own
machine. A phone cannot reach that address. Open the console at the address the guests use, such as
`http://192.168.1.20:8080` or your station's public address, and the code follows it.

## 3. Put the code up

Press **Full screen** on the card. The poster is the code as big as the screen allows, with the
station's name and what is playing. Press **Full screen** again on the poster to fill the display.

To get it onto a TV, use whatever you already have:

- **Chrome**: open the menu, choose **Cast**, then **Cast tab**, and pick the TV.
- **A Mac or iPhone**: mirror the screen to an Apple TV or AirPlay TV.
- **The TV's own browser**: sign in to the console there and open the poster.

The poster keeps the screen awake while it is open. To put a code on the fridge as well, print the
poster from the browser. Anyone who photographs it can join until the party ends, which is what ending
the party is for.

## 4. What a guest does

A guest points their phone's camera at the code and opens the link. The page joins the party on its
own; there is nothing to sign in to.

1. They search by title or artist.
2. They tap a record. A sheet asks for their name, who it is for, and a message. All three are
   optional, and a guest who leaves the name blank is "a listener".
3. They press **Send request**.

The page tells them at once what happened: on its way, waiting for you, or turned down with the
station's reason. **Your requests** lists each one and keeps itself up to date, so they can see when
theirs is coming up and when it played. A guest who closes the page and opens it again is still the
same guest.

The presenter says the dedication just before the record, in their own words. A message that is not fit
to broadcast is left out, and a name that looks like somebody else's station or presenter is not said.

## 5. Watch the requests

Every request, from a guest or anybody else, lands in the list under the card. A guest's says **At
the party**. You can **Decline** one that is waiting, with a reason the guest sees.

To decide on every request yourself, set **Who lets a request through** to **An operator, one at a
time** under **Settings → Rotation**. Each request then waits until you **Grant** it, which suits a
party where you do not know everybody.

## 6. End the party

Press **End the party** on the card. The code stops working and every guest's page says the party has
ended. Records already in the running order still play.

Starting a new party also ends the last one, so there is only ever one code to scan. A party that
runs out of time ends on its own.

## If it goes wrong

- **The guest's phone cannot open the page.** It is not on a network that reaches the station, or the
  code points at an address only you can reach. See the `localhost` note in step 2.
- **The page says the party has ended.** It has, or it ran out of time. Start a new party; the old code
  will not come back.
- **The search finds nothing.** The record is not in your library and your music providers could not
  be asked. A provider that has run out of its allowance answers nothing until it recovers. The
  activity feed and **Settings → Plugins** say which.
- **A request was turned down.** The page says why. The usual reasons are one request at a time, the
  wait between one guest's requests, too many waiting at once, the record having played recently, or
  the station being off the air.
- **The page says the party is full.** A party admits 300 guests. Start a new one if you need more.

## Next

- [The programme](../features/programme.md#requests) for how requests are placed and the rules they
  follow.
- [Make a show](./make-a-show.md) to put a weekly request show on the timetable.
