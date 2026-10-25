---
title: 'Request a break'
sidebar_label: 'Request a break'
sidebar_position: 20
mdx:
    format: 'md'
---

Asks the station to say something now rather than when the format clock next calls for it: the news, the weather, a word from the host. The director decides where it goes. A decline is answered rather than thrown, with the station's reason, because "breaks are off" and "it was asked for a moment ago" are things the person pressing the button needs to read

**`POST`** `/director/air/breaks`

:::note
SDK method: `requestABreak`
Security: authenticated (policy: platform.manage)
:::

## Request body (`application/json`)

Accepts a [RequestStationBreakInput](../models/director/request-station-break-input.md) object.

## Response

`200 OK` — Returns a [StationBreakRequest](../models/director/station-break-request.md) object.
