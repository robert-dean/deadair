---
title: 'Rescan plugins'
sidebar_label: 'Rescan plugins'
sidebar_position: 3
mdx:
    format: 'md'
---

Rescans the mounted plugin directory: registers new plugins, unloads removed ones

**`POST`** `/plugins/rescan`

:::note
SDK method: `rescanPlugins`
Security: authenticated (policy: platform.manage)
:::

## Response

`200 OK` — Returns a list of [PluginSummary](../models/plugins/plugin-summary.md) objects.
