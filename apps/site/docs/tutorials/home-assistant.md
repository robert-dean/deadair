---
title: Light up an On Air sign with Home Assistant
description: Send the station's events to Home Assistant so a light follows what is on air, check a delivery's signature anywhere that can, and drive the station back from Home Assistant.
---

# Light up an On Air sign with Home Assistant

By the end of this page a light in your home turns on whenever the station is talking, a break, a
bulletin or a phone-in, and off when a record or a programme comes on or the station stops. The same
events can drive anything else Home Assistant can do, and anything else that takes a webhook, such
as an n8n workflow.

**You need** a station you are an operator of, and Home Assistant on a network the station can reach.
The station is happy to send to an address on your own network.

## How it works

The station tells the servers you name what happens on it as it happens: an **event destination** is
an address it sends a JSON POST to, one per event. Every event has the same shape:

```json
{
    "id": "0b9f6a2e-3c1d-4e5f-8a7b-6c5d4e3f2a1b",
    "type": "talk.started",
    "occurredAt": "2026-10-14T20:14:03.120Z",
    "station": { "key": "main", "name": "Deadair" },
    "data": { "kind": "talkbreak", "durationMs": 38000, "endsAt": "2026-10-14T20:14:41.120Z" }
}
```

What `data` holds depends on `type`. The ones that say what is on air are sent at the moment listeners
hear it, not when the station plans it:

| Event                             | When                                                                                     |
| --------------------------------- | ---------------------------------------------------------------------------------------- |
| `track.started`                   | A record began.                                                                          |
| `talk.started`                    | The station began speaking: a talk break, a bulletin, a welcome. `data.kind` says which. |
| `production.started`              | A phone-in, a guest or banter between hosts began. Sent once per production.             |
| `programme.started`               | A podcast episode or a reading began.                                                    |
| `station.onAir`, `station.offAir` | The station started or stopped, and `data.reason` says why.                              |
| `request.received`                | A listener asked for a record. Not about what is on air.                                 |

Between them the first five always say what is on air, so a light needs no "ended" event: what ends
something is the next thing starting. **Settings → Event destinations** lists every type with an
example, and so does `GET /api/events/types`.

## 1. Make a webhook in Home Assistant

In Home Assistant, create an automation and give it a **Webhook** trigger.

1. Note the **webhook ID** it offers, or type one of your own. Make it long and hard to guess: it is the
   whole of the protection (see [Signatures](#signatures)).
2. Leave **Only accessible from the local network** on, and allow the **POST** method.

The address the station needs is `http://<your Home Assistant>:8123/api/webhook/<webhook ID>`.

## 2. Add the destination in deadair

Open **Settings → Event destinations**.

1. **Name** it, say _On Air light_, and paste the address from step 1 into **Address**.
2. Under **Events to send**, choose `track.started`, `talk.started`, `production.started`,
   `programme.started` and `station.offAir`. Left empty, a destination is sent every event, including
   any the station adds later.
3. Press **Add destination**. The station shows the destination's **signing secret**, once. Home
   Assistant does not need it, so you can press **I have copied it**.
4. Press **Send test**.

**You should see** that the destination took the test event, and what it answered. Home Assistant
answers a webhook with `200`. **Log** lists every attempt, the test included.

## 3. Write the automation

Edit the automation from step 1 in YAML and give it the actions. Replace `light.on_air` with your
light:

```yaml
alias: On Air light follows the station
triggers:
    - trigger: webhook
      webhook_id: your-long-webhook-id
      allowed_methods: [POST]
      local_only: true
actions:
    - choose:
          - conditions: "{{ trigger.json.type in ['talk.started', 'production.started'] }}"
            sequence:
                - action: light.turn_on
                  target: { entity_id: light.on_air }
                  data: { color_name: red }
          - conditions: "{{ trigger.json.type in ['track.started', 'programme.started', 'station.offAir'] }}"
            sequence:
                - action: light.turn_off
                  target: { entity_id: light.on_air }
mode: queued
```

**You should see** the light come on at the next break and go off when the record after it starts.
`trigger.json.data` holds the rest: `trigger.json.data.title` on a `track.started` is the record's
title, for a notification or a display.

## What the station does when Home Assistant is away

Each event is tried again for about two minutes, the length of Home Assistant restarting for an
update. An event that could only arrive after its record has finished is dropped rather than sent
late, because a light switched for a record that has ended is wrong. And a late retry of an older
event never undoes a newer one, so the light cannot flick back on for a break that is over.

A destination that misses twenty events in a row is turned off by the station, with a line on the
activity feed. Its lamp in **Settings → Event destinations** says so, and the last failure under it
says why. Turn it back on in **Edit** when the receiver is back.

## Signatures

Every delivery is signed with the destination's secret, so a receiver that can check it knows the
station sent it and that it was not replayed. Each carries three headers:

- `Deadair-Webhook-Id`: the event's `id`, the same on every retry of it.
- `Deadair-Webhook-Timestamp`: when it was signed, in Unix seconds.
- `Deadair-Webhook-Signature`: `v1=` and the hex HMAC-SHA256, keyed with the secret, of the timestamp,
  a dot, and the raw body.

Home Assistant's webhook trigger cannot check a signature, which is why its webhook ID is the
secret instead and why it is best kept local. Anything that can run a little code can check it, an n8n
Code node included:

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

function fromStation(rawBody, headers, secret, maxAgeSeconds = 300) {
    const timestamp = headers['deadair-webhook-timestamp'];
    if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > maxAgeSeconds) return false;
    const expected = Buffer.from(`v1=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')}`);
    const given = Buffer.from(headers['deadair-webhook-signature'] ?? '');
    return given.length === expected.length && timingSafeEqual(given, expected);
}
```

Check the body exactly as it arrived, before parsing it: the signature is over the bytes. If the
secret is lost, **New secret** makes another, and the old one stops working at once.

## The other way: Home Assistant driving the station

Home Assistant can also tell the station what to do, through the station's own API with a personal
API key. Issue one under **Settings → Sign-in and security**, **API keys**, with **Read and manage**
if it is to change anything, and give Home Assistant a `rest_command`:

```yaml
rest_command:
    deadair_skip:
        url: http://<your station>/api/playout/skip
        method: post
        headers:
            authorization: !secret deadair_api_key
    deadair_stop:
        url: http://<your station>/api/playout/stop
        method: post
        headers:
            authorization: !secret deadair_api_key
```

with `deadair_api_key: Bearer <your key>` in Home Assistant's `secrets.yaml`. `/api/playout/start` puts
the station back on air where Stop left it, and `GET /api/nowplaying` says what is on. The
[API reference](../api-reference/index.md) lists everything else.
