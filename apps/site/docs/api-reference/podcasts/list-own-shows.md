---
title: 'List own shows'
sidebar_label: 'List own shows'
sidebar_position: 6
mdx:
    format: 'md'
---

The shows the station makes for itself

**`GET`** `/podcasts/own`

:::note
SDK method: `listOwnShows`
Security: authenticated (policy: platform.view)
:::

## Response

`200 OK` — Returns a [OwnShowList](../models/podcasts/own-show-list.md) object.
