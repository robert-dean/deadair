---
title: 'Check station releases'
sidebar_label: 'Check station releases'
sidebar_position: 7
mdx:
    format: 'md'
---

Asks GitHub for newer releases now, and answers with what the station then knows

**`POST`** `/station/releases/check`

:::note
SDK method: `checkStationReleases`
Security: authenticated (policy: platform.manage)
:::

## Response

`200 OK` — Returns a [StationReleases](../models/station/station-releases.md) object.
