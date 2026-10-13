---
title: 'List users'
sidebar_label: 'List users'
sidebar_position: 1
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
| `page`     | `number`          | Yes      | The page number                                   |
| `pageSize` | `number`          | Yes      | The page size                                     |
| `sort`     | `'asc' \| 'desc'` | Yes      | The sort order                                    |
| `total`    | `number`          | Yes      | The total number of items                         |
| `active`   | `boolean`         | No       | Optionally filter by whether the items are active |
| `role`     | `PlatformRole`    | No       | Only people holding this role                     |
| `search`   | `string`          | No       | Part of an email address                          |

</details>

## Response

`200 OK` — Returns a [UserPage](../models/users/user-page.md) object.
