---
title: 'PlaylistImportInput'
sidebar_position: 15
mdx:
    format: 'md'
---

> Something to import a playlist from. Exactly one source

<details>
<summary>Attributes (2)</summary>

| Attribute | Type           | Required | Description                                                              |
| --------- | -------------- | -------- | ------------------------------------------------------------------------ |
| `file`    | `PlaylistFile` | No       | A playlist exported from a deadair station                               |
| `name`    | `string`       | No       | What to call the new playlist. Absent keeps the name the source gives it |

</details>
