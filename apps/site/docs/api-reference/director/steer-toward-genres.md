---
title: 'Steer toward genres'
sidebar_label: 'Steer toward genres'
sidebar_position: 23
mdx:
    format: 'md'
---

Leans the station toward some genres for a number of hours, replacing any lean already in force

**`PUT`** `/rules/steer`

:::note
SDK method: `steerTowardGenres`
Security: authenticated (policy: platform.manage)
:::

## Request body (`application/json`)

Accepts a [GenreSteerInput](../models/director/genre-steer-input.md) object.

## Response

`200 OK` — Returns a [GenreSteerReading](../models/director/genre-steer-reading.md) object.
