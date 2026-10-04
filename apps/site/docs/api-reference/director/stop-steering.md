---
title: 'Stop steering'
sidebar_label: 'Stop steering'
sidebar_position: 24
mdx:
    format: 'md'
---

Ends the lean now

**`DELETE`** `/rules/steer`

:::note
SDK method: `stopSteering`
Security: authenticated (policy: platform.manage)
:::

## Response

`200 OK` — Returns a [GenreSteerReading](../models/director/genre-steer-reading.md) object.
