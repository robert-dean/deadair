---
title: 'List stream listeners'
sidebar_label: 'List stream listeners'
sidebar_position: 10
mdx:
    format: 'md'
---

Who is connected to the station's stream right now, over Icecast and over HLS

**`GET`** `/stream/listeners`

:::note
SDK method: `listStreamListeners`
Security: authenticated (policy: platform.manage)
:::

## Response

`200 OK` — Returns a [StreamListeners](../models/stream/stream-listeners.md) object.
