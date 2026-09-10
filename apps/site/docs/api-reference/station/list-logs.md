---
title: 'List logs'
sidebar_label: 'List logs'
sidebar_position: 1
mdx:
    format: 'md'
---

Every log this install has, present or not, with its size and when it was last written

**`GET`** `/logs`

:::note
SDK method: `listLogs`
Security: authenticated (policy: platform.manage)
:::

## Response

`200 OK` — Returns a [LogSourceList](../models/station/log-source-list.md) object.
