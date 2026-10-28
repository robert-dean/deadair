---
title: 'SegmentSource'
sidebar_position: 11
mdx:
    format: 'md'
---

> One stored fact a written break was handed, as it stood when the break was written

<details>
<summary>Attributes (5)</summary>

| Attribute        | Type      | Required | Description                                                                                                                                                  |
| ---------------- | --------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `claim`          | `string`  | Yes      | The sentence the writer was handed                                                                                                                           |
| `sourceUrl`      | `string`  | Yes      | Where a person checks it                                                                                                                                     |
| `sourceQuote`    | `string`  | Yes      | The words there that state it                                                                                                                                |
| `sourceProvider` | `string`  | Yes      | The plugin that fetched the page                                                                                                                             |
| `told`           | `boolean` | Yes      | Whether the break's words said it, as the station read them back. Never the model's own account, and a fact the read-back could not judge counts as not said |

</details>
