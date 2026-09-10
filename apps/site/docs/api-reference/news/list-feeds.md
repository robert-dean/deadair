---
title: 'List feeds'
sidebar_label: 'List feeds'
sidebar_position: 1
mdx:
    format: 'md'
---

Every feed every installed news plugin currently offers

**`GET`** `/news/feeds`

:::note
SDK method: `listFeeds`
Security: authenticated (policy: platform.view)
:::

## Response

`200 OK` — Returns a [StationFeedList](../models/news/station-feed-list.md) object.
