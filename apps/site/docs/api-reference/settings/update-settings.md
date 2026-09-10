---
title: 'Update settings'
sidebar_label: 'Update settings'
sidebar_position: 2
mdx:
    format: 'md'
---

Applies a submitted settings form and answers with the settings as they now stand

**`PUT`** `/settings`

:::note
SDK method: `updateSettings`
Security: authenticated (policy: platform.manage)
:::

## Request body (`application/json`)

Accepts a [StationSettingsInput](../models/settings/station-settings-input.md) object.

## Response

`200 OK` — Returns a [StationSettings](../models/settings/station-settings.md) object.
