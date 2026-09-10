---
title: 'List pads'
sidebar_label: 'List pads'
sidebar_position: 20
mdx:
    format: 'md'
---

Every sound the station holds, board by board

**`GET`** `/pads`

:::note
SDK method: `listPads`
Security: authenticated (policy: platform.view)
:::

## Response

`200 OK` — Returns a [PadList](../models/render/pad-list.md) object.
