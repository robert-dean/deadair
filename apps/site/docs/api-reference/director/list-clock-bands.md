---
title: 'List clock bands'
sidebar_label: 'List clock bands'
sidebar_position: 1
mdx:
    format: 'md'
---

Every band on this station's clock, including the ones switched off, in the operator's own order

**`GET`** `/clock/bands`

:::note
SDK method: `listClockBands`
Security: authenticated (policy: platform.view)
:::

## Response

`200 OK` — Returns a [ClockBandList](../models/director/clock-band-list.md) object.
