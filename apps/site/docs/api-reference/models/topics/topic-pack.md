---
title: 'TopicPack'
sidebar_position: 6
mdx:
    format: 'md'
---

> A station's subjects as one file, to hand to another station. Each entry is read as a `TopicPackRow`
> when it is imported, so one a station cannot use is reported rather than refusing the file

<details>
<summary>Attributes (4)</summary>

| Attribute | Type                        | Required | Description                                                       |
| --------- | --------------------------- | -------- | ----------------------------------------------------------------- |
| `format`  | `'deadair.topics'`          | Yes      | Says the file is a topics file                                    |
| `version` | `number`                    | Yes      | The version of the document's shape. This station reads version 1 |
| `name`    | `string`                    | Yes      | What the file is, as whoever made it would describe it            |
| `topics`  | `Record<string, unknown>[]` | Yes      |                                                                   |

</details>
