---
title: 'List productions'
sidebar_label: 'List productions'
sidebar_position: 1
mdx:
    format: 'md'
---

Everything the station has made or is making, newest first

**`GET`** `/productions`

:::note
SDK method: `listProductions`
Security: authenticated (policy: platform.view)
:::

## Response

`200 OK` — Returns a [ProductionList](../models/productions/production-list.md) object.
