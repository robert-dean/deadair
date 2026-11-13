---
title: 'List festivals'
sidebar_label: 'List festivals'
sidebar_position: 1
mdx:
    format: 'md'
---

Every festival on this station, soonest first, each saying whether it is still to come, on now or over

**`GET`** `/festivals`

:::note
SDK method: `listFestivals`
Security: authenticated (policy: platform.view)
:::

## Response

`200 OK` — Returns a [FestivalList](../models/schedule/festival-list.md) object.
