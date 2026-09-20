---
title: 'PersonaStoryBeat'
sidebar_position: 14
mdx:
    format: 'md'
---

> One part of an arc, in the order it is told. A SCRIPT rather than a summary, because the floor speaks it as it stands

<details>
<summary>Attributes (8)</summary>

| Attribute   | Type                                    | Required | Description                                                                                                           |
| ----------- | --------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------- |
| `id`        | `string`                                | Yes      | _read-only_                                                                                                           |
| `storyId`   | `string`                                | Yes      | _read-only_                                                                                                           |
| `ordinal`   | `number`                                | Yes      | Where it comes in the telling. Gaps are legal: inserting a part between two others must not mean renumbering the rest |
| `beat`      | `string`                                | Yes      |                                                                                                                       |
| `state`     | `'active' \| 'suggested' \| 'rejected'` | Yes      | _read-only_                                                                                                           |
| `origin`    | `'operator' \| 'model'`                 | Yes      | _read-only_                                                                                                           |
| `source`    | `string`                                | No       | Where a proposal came from. Not evidence; see the note on a story's own source. _read-only_                           |
| `createdAt` | `string`                                | Yes      | _read-only_                                                                                                           |

</details>
