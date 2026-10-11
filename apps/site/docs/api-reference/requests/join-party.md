---
title: 'Join party'
sidebar_label: 'Join party'
sidebar_position: 10
mdx:
    format: 'md'
---

Join the party as a guest. Answers 404 for a pass that is unknown, ended or run out, without saying which

**`POST`** `/party/join`

:::note
SDK method: `joinParty`
Security: public
:::

## Request body (`application/json`)

Accepts a [PartyJoin](../models/requests/party-join.md) object.

## Response

`201 Created` — Returns a [PartyGuestSession](../models/requests/party-guest-session.md) object.
