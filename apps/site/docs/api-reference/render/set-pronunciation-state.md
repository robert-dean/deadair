---
title: 'Set pronunciation state'
sidebar_label: 'Set pronunciation state'
sidebar_position: 19
mdx:
    format: 'md'
---

Accepts a proposal, turns one down, or takes an entry out of use without losing what it said

**`PUT`** `/pronunciations/{id}/state`

:::note
SDK method: `setPronunciationState`
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

Accepts a [PronunciationStateWrite](../models/render/pronunciation-state-write.md) object.

## Response

`200 OK` — Returns a [PronunciationList](../models/render/pronunciation-list.md) object.
