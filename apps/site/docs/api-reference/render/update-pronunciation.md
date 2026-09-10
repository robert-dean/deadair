---
title: 'Update pronunciation'
sidebar_label: 'Update pronunciation'
sidebar_position: 17
mdx:
    format: 'md'
---

Rewrites one entry's words, whoever proposed it

**`PUT`** `/pronunciations/{id}`

:::note
SDK method: `updatePronunciation`
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

Accepts a [PronunciationWrite](../models/render/pronunciation-write.md) object.

## Response

`200 OK` — Returns a [PronunciationList](../models/render/pronunciation-list.md) object.
