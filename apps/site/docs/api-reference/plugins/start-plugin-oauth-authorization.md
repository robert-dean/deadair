---
title: 'Start plugin oauth authorization'
sidebar_label: 'Start plugin oauth authorization'
sidebar_position: 16
mdx:
    format: 'md'
---

Reports where to send the operator for the provider's consent screen

**`GET`** `/plugins/{id}/oauth/authorize`

:::note
SDK method: `startPluginOAuthAuthorization`
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

`200 OK` — Returns a [PluginOAuthStart](../models/plugins/plugin-oauth-start.md) object.
