---
title: 'Read persona memory'
sidebar_label: 'Read persona memory'
sidebar_position: 35
mdx:
    format: 'md'
---

What this character has told, newest first. The timeline a moment is picked from

**`GET`** `/personas/{id}/memory`

:::note
SDK method: `readPersonaMemory`
Security: authenticated (policy: platform.view)
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type     | Required | Description     |
| --------- | -------- | -------- | --------------- |
| `id`      | `string` | Yes      | Path parameter. |

</details>

## Response

`200 OK` — Returns a [PersonaMemoryTimeline](../models/personas/persona-memory-timeline.md) object.
