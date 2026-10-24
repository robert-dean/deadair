---
title: 'BreakKindImportNotice'
sidebar_position: 7
mdx:
    format: 'md'
---

> Something to know before pressing Import

<details>
<summary>Attributes (2)</summary>

| Attribute | Type                                                     | Required | Description                                                                            |
| --------- | -------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------- |
| `kind`    | `'format' \| 'duplicate' \| 'switched-off' \| 'refused'` | Yes      | Which sort, so a console can group by it rather than parsing the sentence. _read-only_ |
| `message` | `string`                                                 | Yes      | The whole of it, in the station's own words. _read-only_                               |

</details>
