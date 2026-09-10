---
title: 'CatalogQuery'
sidebar_position: 13
mdx:
    format: 'md'
---

> Pagination plus a name filter. Every list operation here takes it, so the console's search box
> narrows server-side rather than filtering one page client-side and lying about the total.

Extends [`Pagination`](../shared/pagination.md)

<details>
<summary>Attributes (2)</summary>

| Attribute | Type          | Required | Description |
| --------- | ------------- | -------- | ----------- |
| `search`  | `string`      | No       |             |
| `sortBy`  | `CatalogSort` | No       |             |

</details>
