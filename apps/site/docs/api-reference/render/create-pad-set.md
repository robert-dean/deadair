---
title: 'Create pad set'
sidebar_label: 'Create pad set'
sidebar_position: 27
mdx:
    format: 'md'
---

Names a new set, or answers the one already under that key

**`POST`** `/pads/sets`

:::note
SDK method: `createPadSet`
Security: authenticated (policy: platform.manage)
:::

## Request body (`application/json`)

Accepts a [PadSetWrite](../models/render/pad-set-write.md) object.

## Response

`200 OK` — Returns a [PadList](../models/render/pad-list.md) object.
