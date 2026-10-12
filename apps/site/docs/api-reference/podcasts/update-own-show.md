---
title: 'Update own show'
sidebar_label: 'Update own show'
sidebar_position: 8
mdx:
    format: 'md'
---

Rewrites a show. Episodes already asked for keep what they were asked with

**`PUT`** `/podcasts/own/{id}`

:::note
SDK method: `updateOwnShow`
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

Accepts a [OwnShow](../models/podcasts/own-show.md) object.

## Response

`200 OK` — Returns a [OwnShow](../models/podcasts/own-show.md) object.
