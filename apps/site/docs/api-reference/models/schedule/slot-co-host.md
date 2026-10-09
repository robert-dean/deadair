---
title: 'SlotCoHost'
sidebar_position: 3
mdx:
    format: 'md'
---

> Somebody who presents beside a slot's host, every night or some of them

<details>
<summary>Attributes (4)</summary>

| Attribute      | Type       | Required | Description                                                                                                                                       |
| -------------- | ---------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `personaId`    | `string`   | Yes      | Who co-presents. A host; a caller or a guest who drops by can never present a show                                                                |
| `days`         | `number[]` | No       | The nights they co-present, by the weekday the night begins on, Sunday 0. Absent with no `everyN` is every night. Send this or `everyN`, not both |
| `everyN`       | `number`   | No       | Or as a visitor: about one of this slot's nights in this many, on nights nobody can predict                                                       |
| `cooldownDays` | `number`   | No       | With `everyN`, the fewest days between two of their nights. Absent is half of `everyN`                                                            |

</details>
