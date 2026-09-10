---
title: 'Stop playout'
sidebar_label: 'Stop playout'
sidebar_position: 6
mdx:
    format: 'md'
---

Stands the station down: stops what is on air at once and hands the mount back. The running order is LEFT as it is, so `/playout/start` can pick it up where this stopped it. deadair holds the mount on a lease it renews while it has something to play, so stopping goes quiet rather than falling through to a bed nobody programmed

**`POST`** `/playout/stop`

:::note
SDK method: `stopPlayout`
Security: authenticated (policy: platform.manage)
:::

## Response

`200 OK` — Returns a [PlayoutStatus](../models/playout/playout-status.md) object.
