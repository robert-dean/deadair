---
title: 'Reload plugin'
sidebar_label: 'Reload plugin'
sidebar_position: 10
mdx:
    format: 'md'
---

Reapplies the plugin's stored configuration: disposes the running instance and initializes it again

**`POST`** `/plugins/{id}/reload`

:::note
SDK method: `reloadPlugin`
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
