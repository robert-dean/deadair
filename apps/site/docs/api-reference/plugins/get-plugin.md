---
title: 'Get plugin'
sidebar_label: 'Get plugin'
sidebar_position: 5
mdx:
    format: 'md'
---

One plugin, including its stored non-secret configuration and last error

**`GET`** `/plugins/{id}`

:::note
SDK method: `getPlugin`
Security: authenticated (policy: platform.view)
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type     | Required | Description     |
| --------- | -------- | -------- | --------------- |
| `id`      | `string` | Yes      | Path parameter. |

</details>

## Response

`200 OK` — Returns a [PluginDetail](../models/plugins/plugin-detail.md) object.
