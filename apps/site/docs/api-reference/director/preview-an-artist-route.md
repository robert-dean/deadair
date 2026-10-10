---
title: 'Preview an artist route'
sidebar_label: 'Preview an artist route'
sidebar_position: 12
mdx:
    format: 'md'
---

Finds a route from one artist to another through artists the library holds, and says how each stop connects to the one before. Nothing goes on air: this is what a route would be

**`POST`** `/director/route/preview`

:::note
SDK method: `previewAnArtistRoute`
Security: authenticated (policy: platform.manage)
:::

## Request body (`application/json`)

Accepts a [RoutePreviewInput](../models/director/route-preview-input.md) object.

## Response

`200 OK` — Returns a [ArtistRoute](../models/director/artist-route.md) object.
