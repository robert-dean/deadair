---
title: 'Add a festival'
sidebar_label: 'Add a festival'
sidebar_position: 2
mdx:
    format: 'md'
---

Adds a festival. A show names it from the schedule, and nothing is said about it until one does

**`POST`** `/festivals`

:::note
SDK method: `addAFestival`
Security: authenticated (policy: platform.manage)
:::

## Request body (`application/json`)

Accepts a [Festival](../models/schedule/festival.md) object.

## Response

`200 OK` — Returns a [FestivalList](../models/schedule/festival-list.md) object.
