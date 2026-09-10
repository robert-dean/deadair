---
title: 'Get playout status'
sidebar_label: 'Get playout status'
sidebar_position: 1
mdx:
    format: 'md'
---

What the station is playing and what is queued behind it. The console polls this

**`GET`** `/playout/status`

:::note
SDK method: `getPlayoutStatus`
Security: authenticated (policy: platform.view)
:::

## Response

`200 OK` — Returns a [PlayoutStatus](../models/playout/playout-status.md) object.
