---
title: 'Keep the station quiet'
sidebar_label: 'Keep the station quiet'
sidebar_position: 20
mdx:
    format: 'md'
---

Keeps the station's own breaks off the air for the next so many records, and takes out the ones already planned across them. Asking again replaces the count

**`PUT`** `/director/air/quiet`

:::note
SDK method: `keepTheStationQuiet`
Security: authenticated (policy: platform.manage)
:::

## Request body (`application/json`)

Accepts a [QuietStationInput](../models/director/quiet-station-input.md) object.

## Response

`200 OK` — Returns a [StationAir](../models/director/station-air.md) object.
