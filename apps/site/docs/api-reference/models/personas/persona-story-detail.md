---
title: 'PersonaStoryDetail'
sidebar_position: 11
mdx:
    format: 'md'
---

> One thing a story has picked up since it was written. A row rather than a rewrite, so an invented clause can be turned down without losing the story

<details>
<summary>Attributes (6)</summary>

| Attribute   | Type                                    | Required | Description |
| ----------- | --------------------------------------- | -------- | ----------- |
| `id`        | `string`                                | Yes      | _read-only_ |
| `detail`    | `string`                                | Yes      |             |
| `state`     | `'active' \| 'suggested' \| 'rejected'` | Yes      | _read-only_ |
| `origin`    | `'operator' \| 'model'`                 | Yes      | _read-only_ |
| `source`    | `string`                                | No       | _read-only_ |
| `createdAt` | `string`                                | Yes      | _read-only_ |

</details>
