---
title: 'List pronunciations'
sidebar_label: 'List pronunciations'
sidebar_position: 15
mdx:
    format: 'md'
---

The station's lexicon: what it says, what has been proposed to it, and what it has turned down

**`GET`** `/pronunciations`

:::note
SDK method: `listPronunciations`
Security: authenticated (policy: platform.view)
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type                                    | Required | Description         |
| --------- | --------------------------------------- | -------- | ------------------- |
| `state`   | `'active' \| 'suggested' \| 'rejected'` | No       | Absent is all of it |

</details>

## Response

`200 OK` — Returns a [PronunciationList](../models/render/pronunciation-list.md) object.
