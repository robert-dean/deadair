---
title: 'List casts'
sidebar_label: 'List casts'
sidebar_position: 2
mdx:
    format: 'md'
---

Every speaker the station is meant to be playing on, each asked how it is doing now

**`GET`** `/outputs/casts`

:::note
SDK method: `listCasts`
Security: authenticated (policy: platform.view)
:::

## Response

`200 OK` — Returns a [OutputCastList](../models/outputs/output-cast-list.md) object.
