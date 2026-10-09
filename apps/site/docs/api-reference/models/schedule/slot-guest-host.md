---
title: 'SlotGuestHost'
sidebar_position: 2
mdx:
    format: 'md'
---

> A host who sits in on a slot on some nights, saying whose show it usually is

<details>
<summary>Attributes (4)</summary>

| Attribute      | Type       | Required | Description                                                                                                                                 |
| -------------- | ---------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `personaId`    | `string`   | Yes      | Who sits in. A host; a caller or a guest who drops by can never present a show                                                              |
| `days`         | `number[]` | No       | The nights they present, by the weekday the night begins on, Sunday 0. Send this or `everyN`, not both                                      |
| `everyN`       | `number`   | No       | Or at random: about one of this slot's nights in this many, on nights nobody can predict. 7 is about one in seven                           |
| `cooldownDays` | `number`   | No       | With `everyN`, the fewest days between two of their nights. Absent is half of `everyN`, so even one in seven never lands two nights running |

</details>
