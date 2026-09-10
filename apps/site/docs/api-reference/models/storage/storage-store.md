---
title: 'StorageStore'
sidebar_position: 2
mdx:
    format: 'md'
---

> One content store: what is on disk, and what the database says should be.
>
> The two halves are deliberately separate numbers rather than one reconciled figure. They disagree
> in two directions and each direction means something different — a file nothing claims is what a
> crash between writing bytes and writing a row leaves behind, and a row whose file is gone is what
> an operator emptying a directory leaves. Reporting one number would hide both.

<details>
<summary>Attributes (11)</summary>

| Attribute        | Type             | Required | Description                                                                                       |
| ---------------- | ---------------- | -------- | ------------------------------------------------------------------------------------------------- |
| `id`             | `StorageStoreId` | Yes      | _read-only_                                                                                       |
| `label`          | `string`         | Yes      | What to call it on a page. _read-only_                                                            |
| `path`           | `string`         | Yes      | Where it is, so `du` and this can be compared. _read-only_                                        |
| `files`          | `number`         | Yes      | Files actually there. _read-only_                                                                 |
| `bytes`          | `number`         | Yes      | What they weigh. _read-only_                                                                      |
| `rows`           | `number`         | No       | Rows pointing at a file. Absent when no table backs this store. _read-only_                       |
| `accountedBytes` | `number`         | No       | What those rows say those files weigh. Absent where the table does not record a size. _read-only_ |
| `capBytes`       | `number`         | No       | The limit an operator set, where the store has one. Absent means no limit. _read-only_            |
| `orphanFiles`    | `number`         | Yes      | Files no row claims. Reported and never cleaned up automatically. _read-only_                     |
| `orphanBytes`    | `number`         | Yes      | _read-only_                                                                                       |
| `rowsWithNoFile` | `number`         | Yes      | Claims whose file is not there. The station re-fetches or re-renders these. _read-only_           |

</details>
