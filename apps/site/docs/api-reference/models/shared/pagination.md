---
title: 'Pagination'
sidebar_position: 1
mdx:
    format: 'md'
---

> Represents a pagination object

<details>
<summary>Attributes (4)</summary>

| Attribute  | Type              | Required | Description                            |
| ---------- | ----------------- | -------- | -------------------------------------- |
| `page`     | `number`          | Yes      | The page number. _default: `0`_        |
| `pageSize` | `number`          | Yes      | The page size. _default: `25`_         |
| `sort`     | `'asc' \| 'desc'` | Yes      | The sort order. _default: `desc`_      |
| `total`    | `number`          | Yes      | The total number of items. _read-only_ |

</details>
