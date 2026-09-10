---
title: 'List segments'
sidebar_label: 'List segments'
sidebar_position: 1
mdx:
    format: 'md'
---

Everything the station can play that is not a record

**`GET`** `/segments`

:::note
SDK method: `listSegments`
Security: authenticated (policy: platform.view)
:::

## Response

`200 OK` — Returns a [SegmentList](../models/render/segment-list.md) object.
