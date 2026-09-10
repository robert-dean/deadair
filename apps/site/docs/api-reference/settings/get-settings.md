---
title: 'Get settings'
sidebar_label: 'Get settings'
sidebar_position: 1
mdx:
    format: 'md'
---

Every station setting, its descriptor and its current value

**`GET`** `/settings`

:::note
SDK method: `getSettings`
Security: authenticated (policy: platform.view)
:::

## Response

`200 OK` — Returns a [StationSettings](../models/settings/station-settings.md) object.
