---
title: 'Fetch pad'
sidebar_label: 'Fetch pad'
sidebar_position: 23
mdx:
    format: 'md'
---

Fetches a sound from an address and puts it on a board. The operator names the address, so this is them choosing a file exactly as dropping one in the library is

**`POST`** `/pads/fetch`

:::note
SDK method: `fetchPad`
Security: authenticated (policy: platform.manage)
:::

## Request body (`application/json`)

Accepts a [PadFetch](../models/render/pad-fetch.md) object.

## Response

`200 OK` — Returns a [PadList](../models/render/pad-list.md) object.

`400 Bad Request`

`409 Conflict`

`413`

`415`

`502`
