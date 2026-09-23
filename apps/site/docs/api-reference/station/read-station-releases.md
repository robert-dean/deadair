---
title: 'Read station releases'
sidebar_label: 'Read station releases'
sidebar_position: 6
mdx:
    format: 'md'
---

The releases this build contains and what each one changed, newest first

**`GET`** `/station/releases`

:::note
SDK method: `readStationReleases`
Security: authenticated (policy: platform.view)
:::

## Response

`200 OK` — Returns a [StationReleases](../models/station/station-releases.md) object.
