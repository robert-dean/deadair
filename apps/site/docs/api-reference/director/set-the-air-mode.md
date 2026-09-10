---
title: 'Set the air mode'
sidebar_label: 'Set the air mode'
sidebar_position: 7
mdx:
    format: 'md'
---

Changes what puts the station on air: only while somebody is listening, or whenever there is a programme. Takes effect at once rather than at the next boundary

**`PATCH`** `/director/air`

:::note
SDK method: `setTheAirMode`
Security: authenticated (policy: platform.manage)
:::

## Request body (`application/json`)

Accepts a [SetStationAirInput](../models/director/set-station-air-input.md) object.

## Response

`200 OK` — Returns a [StationAir](../models/director/station-air.md) object.
