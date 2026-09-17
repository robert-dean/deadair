---
title: 'List break artwork'
sidebar_label: 'List break artwork'
sidebar_position: 1
mdx:
    format: 'md'
---

Every kind the station holds a picture for

**`GET`** `/art/breaks`

:::note
SDK method: `listBreakArtwork`
Security: authenticated (policy: platform.view)
:::

## Response

`200 OK` — Returns a [BreakArtworkList](../models/art/break-artwork-list.md) object.
