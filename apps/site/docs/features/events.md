---
title: Event destinations
sidebar_position: 13.5
description: The station telling your own servers what happens on air, as a signed JSON POST per event, so a light, an automation or a workflow can follow it.
---

The station can tell servers you run what happens on it as it happens. An **event destination** is an address it sends a JSON POST to, one per event: a Home Assistant webhook trigger, an n8n workflow, or anything else that takes a webhook. [Light up an On Air sign with Home Assistant](../tutorials/home-assistant.md) walks through one from start to finish; this page is the reference.

Destinations are under **Settings → Event destinations**, and only an operator can see or change them, reads included, because a destination's address is often the whole of its receiver's protection. An address on your own network is fine: the receiver this is for usually lives there.

## The events

Every event has the same shape. `type` says which event it is, and that decides what `data` holds:

```json
{
    "id": "0b9f6a2e-3c1d-4e5f-8a7b-6c5d4e3f2a1b",
    "type": "track.started",
    "occurredAt": "2026-10-14T20:14:03.120Z",
    "station": { "key": "main", "name": "Deadair" },
    "data": { "title": "Pink Moon", "artist": "Nick Drake", "durationMs": 124000, "endsAt": "2026-10-14T20:16:07.120Z" }
}
```

Times are ISO-8601 in UTC, and every length inside `data` is whole milliseconds. `id` is made once per event and kept across retries, so a receiver can tell a second attempt from a second event.

| Event                | When                                                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `track.started`      | A record began playing. `endsAt` is when it should finish.                                                             |
| `talk.started`       | The station began speaking: a talk break, a bulletin, a welcome. `kind` says which.                                    |
| `production.started` | A produced piece began: a phone-in, a guest, banter between hosts. Sent once per production, when it first airs.        |
| `programme.started`  | A programme began: a podcast episode, or something the station reads out (`narration`).                                |
| `station.onAir`      | The station went on air, with a new running order (`programme`) or on the one it was stopped on (`resumed`).           |
| `station.offAir`     | The station came off air: somebody stopped it (`stopped`), or its running order ran out (`ranOut`).                     |
| `request.received`   | A listener asked for a record, from an app, the console, a party pass or a chat. Sent for a refusal too, with `status`. |

The four `started` events are sent at the moment listeners hear the thing start, not when the station plans it, which can be minutes earlier. Between them they say what is on air at every moment, so there is no "ended" event: what ends something is the next thing starting. A dedication on `request.received` is sent in the listener's own words, since the receiver is your own server.

Every type is listed with an example under **Settings → Event destinations**, and `GET /api/events/types` answers the same list. A test delivery sends `destination.test`, which nothing can subscribe to.

## Adding one

**Name** it, give its **Address** (`http` or `https`, with no username or password in it; a receiver that wants a token takes it in the path or the query), and choose **Events to send**. Left empty, a destination is sent every event, including any the station adds later. **On** decides whether it is sent anything.

**Add destination** shows the destination's **signing secret** once, and never again. **Send test** sends it a test event whether it is on or not, and says whether it was taken and what it answered. **Log** lists the latest fifty attempts, the tests included, newest first: delivered, failed or dropped, with the attempt, the answer and how long it took. **Edit** changes it, **New secret** replaces the secret (the old one stops working at once), and **Remove** stops it and deletes its log.

## Signatures

Every delivery is signed with the destination's secret, so a receiver that checks knows the station sent it and that it was not replayed. Each carries three headers:

- `Deadair-Webhook-Id`: the event's `id`.
- `Deadair-Webhook-Timestamp`: when it was signed, in Unix seconds.
- `Deadair-Webhook-Signature`: `v1=` and the hex HMAC-SHA256, keyed with the secret, of the timestamp, a dot, and the body exactly as sent.

Check the raw body before parsing it, and refuse a timestamp more than a few minutes old. The tutorial has [a few lines that check one](../tutorials/home-assistant.md#signatures). A receiver that cannot check a signature, such as Home Assistant's webhook trigger, is protected by a long, unguessable address instead, and is best kept to your own network.

## When a receiver is away

A delivery is tried again three times over about two minutes, the length of a hub restarting. 2xx is delivered. A timeout (five seconds to the answer), a refused connection, 408, 429 and any 5xx are tried again. Any other 4xx is not, and neither is a redirect: the station never follows one, so save the address it moved to.

An event is dropped rather than sent late once it would be false: a `track.started` for a record that has already finished, say. And an older on-air event never overtakes a newer one, so a retried `talk.started` cannot land after the `track.started` that followed it and switch a light back on. A request stays worth sending for an hour.

Twenty deliveries in a row that do not arrive turn a destination off, with a line on the activity feed; its lamp says **Turned off by the station** and the last failure says why. Only an event's last attempt counts, so a restart costs one failure per event that fell in the gap rather than four. Turning it back on in **Edit** clears the count. Tests never count.

## Not to be confused with

- **The activity feed** is the station's record of what happened, written as sentences for a person. Event destinations are the same kind of moments written for a machine.
- **Chat platforms** ([Telegram, Discord and Slack](../tutorials/chat-platforms.md)) announce what airs as messages in a channel, through a plugin per platform. A destination is your own server, and needs no plugin.
- **Driving the station** from Home Assistant or anything else goes the other way, through [the API](../develop/api.md) with an API key. The tutorial [has an example](../tutorials/home-assistant.md#the-other-way-home-assistant-driving-the-station).
