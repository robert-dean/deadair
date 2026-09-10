---
title: 'TopicKindDescriptor'
sidebar_position: 3
mdx:
    format: 'md'
---

> A sort of break that has subjects at all, and how one of its subjects is edited. `ConfigFieldDescriptor` is the plugins area's, shared for the reason a station setting shares it: one form component renders them all

<details>
<summary>Attributes (5)</summary>

| Attribute     | Type                      | Required | Description                                                                                 |
| ------------- | ------------------------- | -------- | ------------------------------------------------------------------------------------------- |
| `kind`        | `string`                  | Yes      |                                                                                             |
| `nounOne`     | `string`                  | Yes      | What to call one of these: a news subject is a category and a weather subject is a location |
| `nounMany`    | `string`                  | Yes      |                                                                                             |
| `description` | `string`                  | Yes      |                                                                                             |
| `fields`      | `ConfigFieldDescriptor[]` | Yes      |                                                                                             |

</details>
