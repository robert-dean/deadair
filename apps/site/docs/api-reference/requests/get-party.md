---
title: 'Get party'
sidebar_label: 'Get party'
sidebar_position: 8
mdx:
    format: 'md'
---

The party that is on, with its pass, so the console can show the QR code again

**`GET`** `/party`

:::note
SDK method: `getParty`
Security: authenticated (policy: platform.manage)
:::

## Response

`200 OK` — Returns a [PartyState](../models/requests/party-state.md) object.
