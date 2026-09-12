---
title: 'Set plugin log level'
sidebar_label: 'Set plugin log level'
sidebar_position: 15
mdx:
    format: 'md'
---

Sets the minimum severity the plugin's log store retains going forward

**`PUT`** `/plugins/{id}/logs/level`

:::note
SDK method: `setPluginLogLevel`
Security: authenticated (policy: platform.manage)
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type     | Required | Description     |
| --------- | -------- | -------- | --------------- |
| `id`      | `string` | Yes      | Path parameter. |

</details>

## Request body (`application/json`)

Accepts a [PluginLogLevelInput](../models/plugins/plugin-log-level-input.md) object.

## Response

`200 OK` — Returns a [PluginDetail](../models/plugins/plugin-detail.md) object.
