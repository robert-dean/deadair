---
title: 'Delete pronunciation'
sidebar_label: 'Delete pronunciation'
sidebar_position: 18
mdx:
    format: 'md'
---

Removes an entry outright. Turning a PROPOSAL down is a state rather than a deletion, because a deleted one comes back on the next pass

**`DELETE`** `/pronunciations/{id}`

:::note
SDK method: `deletePronunciation`
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

`200 OK` — Returns a [PronunciationList](../models/render/pronunciation-list.md) object.
