---
title: 'Decide plugin grant'
sidebar_label: 'Decide plugin grant'
sidebar_position: 9
mdx:
    format: 'md'
---

Answers one capability this plugin asked for. Takes effect on the next fetch, with no reload

**`PUT`** `/plugins/{id}/grants`

:::note
SDK method: `decidePluginGrant`
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

Accepts a [PluginGrantInput](../models/plugins/plugin-grant-input.md) object.

## Response

`200 OK` — Returns a [PluginGrantList](../models/plugins/plugin-grant-list.md) object.
