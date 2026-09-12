---
title: 'Disconnect plugin oauth'
sidebar_label: 'Disconnect plugin oauth'
sidebar_position: 18
mdx:
    format: 'md'
---

Forgets the plugin's stored OAuth tokens and reinitializes it

**`DELETE`** `/plugins/{id}/oauth`

:::note
SDK method: `disconnectPluginOAuth`
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
