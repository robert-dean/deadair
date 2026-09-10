---
title: 'List plugins'
sidebar_label: 'List plugins'
sidebar_position: 1
mdx:
    format: 'md'
---

Lists every plugin the host knows about

**`GET`** `/plugins`

:::note
SDK method: `listPlugins`
Security: authenticated (policy: platform.view)
:::

## Response

`200 OK` — Returns a list of [PluginSummary](../models/plugins/plugin-summary.md) objects.
