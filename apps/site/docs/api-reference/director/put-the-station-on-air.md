---
title: 'Put the station on air'
sidebar_label: 'Put the station on air'
sidebar_position: 6
mdx:
    format: 'md'
---

Puts the station on air, building the running order from a playlist read at this moment. What is playing finishes: changing the programming is not a reason to cut a listener off mid-track

**`POST`** `/director/air`

:::note
SDK method: `putTheStationOnAir`
Security: authenticated (policy: platform.manage)
:::

## Request body (`application/json`)

Accepts a [PutOnAirInput](../models/director/put-on-air-input.md) object.

## Response

`200 OK` — Returns a [StationAir](../models/director/station-air.md) object.
