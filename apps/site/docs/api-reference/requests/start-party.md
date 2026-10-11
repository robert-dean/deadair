---
title: 'Start party'
sidebar_label: 'Start party'
sidebar_position: 8
mdx:
    format: 'md'
---

Start a party. A party already on is ended first, which turns its guests away, so there is only ever one pass to scan

**`POST`** `/party`

:::note
SDK method: `startParty`
Security: authenticated (policy: platform.manage)
:::

## Request body (`application/json`)

Accepts a [PartyStart](../models/requests/party-start.md) object.

## Response

`201 Created` — Returns a [PartyPass](../models/requests/party-pass.md) object.
