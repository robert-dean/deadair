---
title: 'Update plugin configuration'
sidebar_label: 'Update plugin configuration'
sidebar_position: 5
mdx:
    format: 'md'
---

Validates against the plugin's own config schema, encrypts secrets, persists, and reinitializes

**`PUT`** `/plugins/{id}/config`

:::note
SDK method: `updatePluginConfiguration`
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

Accepts a [PluginConfigInput](../models/plugins/plugin-config-input.md) object.

## Response

`200 OK` — Returns a [PluginDetail](../models/plugins/plugin-detail.md) object.
