---
title: 'OccasionPack'
sidebar_position: 5
mdx:
    format: 'md'
---

> A set of occasions as one file, to hand to another station. Each entry is read as an `OccasionPackRow`
> when it is imported, so one a station cannot use is reported rather than refusing the file

<details>
<summary>Attributes (4)</summary>

| Attribute   | Type                        | Required | Description                                                                 |
| ----------- | --------------------------- | -------- | --------------------------------------------------------------------------- |
| `format`    | `'deadair.occasions'`       | Yes      | Says the file is an occasion pack                                           |
| `version`   | `number`                    | Yes      | The version of the document's shape. This station reads version 1           |
| `name`      | `string`                    | Yes      | What the pack is, as whoever made it would describe it: `Canadian holidays` |
| `occasions` | `Record<string, unknown>[]` | Yes      |                                                                             |

</details>
