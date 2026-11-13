---
title: 'Export schedule'
sidebar_label: 'Export schedule'
sidebar_position: 17
mdx:
    format: 'md'
---

This station's schedule as one file, to hand to another station. Slots name characters by key and playlists by name

**`GET`** `/schedule/export`

:::note
SDK method: `exportSchedule`
Security: authenticated (policy: platform.manage)
:::

## Response

`200 OK` — Returns a [SchedulePack](../models/schedule/schedule-pack.md) object.
