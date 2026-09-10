---
title: 'StorageReport'
sidebar_position: 3
mdx:
    format: 'md'
---

> Every store, plus the number an operator actually wants first.
>
> `readAt` is not decoration: the figures come from walking directories, which is real I/O on a
> station holding tens of thousands of files, so the answer is cached for a short while and this is
> what stops a page mistaking it for live.

<details>
<summary>Attributes (4)</summary>

| Attribute    | Type             | Required | Description |
| ------------ | ---------------- | -------- | ----------- |
| `readAt`     | `string`         | Yes      | _read-only_ |
| `totalFiles` | `number`         | Yes      | _read-only_ |
| `totalBytes` | `number`         | Yes      | _read-only_ |
| `stores`     | `StorageStore[]` | Yes      |             |

</details>
