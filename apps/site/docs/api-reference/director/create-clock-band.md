---
title: 'Create clock band'
sidebar_label: 'Create clock band'
sidebar_position: 2
mdx:
    format: 'md'
---

Adds a band. It claims its first boundary on the next commit pass

**`POST`** `/clock/bands`

:::note
SDK method: `createClockBand`
Security: authenticated (policy: platform.manage)
:::

## Request body (`application/json`)

Accepts a [ClockBand](../models/director/clock-band.md) object.

## Response

`201 Created` — Returns a [ClockBandList](../models/director/clock-band-list.md) object.
