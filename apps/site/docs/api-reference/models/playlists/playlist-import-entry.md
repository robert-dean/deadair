---
title: 'PlaylistImportEntry'
sidebar_position: 17
mdx:
    format: 'md'
---

> What importing one record would do here

<details>
<summary>Attributes (5)</summary>

| Attribute  | Type                                 | Required | Description                                                                                                                                                                                           |
| ---------- | ------------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `position` | `number`                             | Yes      |                                                                                                                                                                                                       |
| `title`    | `string`                             | Yes      |                                                                                                                                                                                                       |
| `artists`  | `string[]`                           | Yes      |                                                                                                                                                                                                       |
| `outcome`  | `'matched' \| 'toAdd' \| 'toLookUp'` | Yes      | `matched`: the library holds it. `toAdd`: it names a provider's copy, which the station can add to its library. `toLookUp`: it names only a record, which the station has to search its providers for |
| `trackId`  | `string`                             | No       | The library record a `matched` row plays                                                                                                                                                              |

</details>
