---
title: 'Enable plugin'
sidebar_label: 'Enable plugin'
sidebar_position: 7
mdx:
    format: 'md'
---

Enables a plugin without resubmitting its configuration

**`POST`** `/plugins/{id}/enable`

:::note
SDK method: `enablePlugin`
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
