---
title: 'StationBacklog'
sidebar_position: 11
mdx:
    format: 'md'
---

> How much of the library the station has actually looked at.
>
> The counts `/catalog/tracks` already answers with, lifted out of a page of rows: a check-up wants
> the sentence "13 of 581 measured" without asking for thirteen tracks to get it.

<details>
<summary>Attributes (3)</summary>

| Attribute  | Type     | Required | Description |
| ---------- | -------- | -------- | ----------- |
| `total`    | `number` | Yes      | _read-only_ |
| `cached`   | `number` | Yes      | _read-only_ |
| `measured` | `number` | Yes      | _read-only_ |

</details>
