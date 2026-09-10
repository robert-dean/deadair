---
title: 'Disable plugin'
sidebar_label: 'Disable plugin'
sidebar_position: 7
mdx:
    format: 'md'
---

Disables a plugin and tears its instance down, keeping its configuration

**`POST`** `/plugins/{id}/disable`

:::note
SDK method: `disablePlugin`
Security: authenticated (policy: platform.manage)
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
