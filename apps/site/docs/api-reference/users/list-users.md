---
title: 'List users'
sidebar_label: 'List users'
sidebar_position: 7
mdx:
    format: 'md'
---

The station's people, one page at a time, ordered by when their account was made

**`GET`** `/users`

:::note
SDK method: `listUsers`
Security: authenticated (policy: platform.manage)
:::

## Attributes

<details>
<summary>Attributes (7)</summary>

| Attribute  | Type              | Required | Description                                       |
| ---------- | ----------------- | -------- | ------------------------------------------------- |
| `total`    | `number`          | Yes      | The total number of items                         |
| `active`   | `boolean`         | No       | Optionally filter by whether the items are active |
| `page`     | `number`          | No       | The page number                                   |
| `pageSize` | `number`          | No       | The page size                                     |
| `role`     | `PlatformRole`    | No       | Only people holding this role                     |
| `search`   | `string`          | No       | Part of an email address                          |
| `sort`     | `'asc' \| 'desc'` | No       | The sort order                                    |

</details>

## Response

`200 OK` — Returns a [UserPage](../models/users/user-page.md) object.
