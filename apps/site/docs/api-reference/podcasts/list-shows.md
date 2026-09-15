---
title: 'List shows'
sidebar_label: 'List shows'
sidebar_position: 1
mdx:
    format: 'md'
---

Every programme every installed podcast plugin carries

**`GET`** `/podcasts/shows`

:::note
SDK method: `listShows`
Security: authenticated (policy: platform.view)
:::

## Response

`200 OK` — Returns a [StationShowList](../models/podcasts/station-show-list.md) object.
