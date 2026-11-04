---
title: 'Export clock'
sidebar_label: 'Export clock'
sidebar_position: 9
mdx:
    format: 'md'
---

This station's format clock as one file, to hand to another station

**`GET`** `/clock/export`

:::note
SDK method: `exportClock`
Security: authenticated (policy: platform.manage)
:::

## Response

`200 OK` — Returns a [ClockPack](../models/director/clock-pack.md) object.
