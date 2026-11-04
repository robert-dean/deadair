---
title: 'ScheduleSlotList'
sidebar_position: 13
mdx:
    format: 'md'
---

<details>
<summary>Attributes (2)</summary>

| Attribute     | Type             | Required | Description                                                               |
| ------------- | ---------------- | -------- | ------------------------------------------------------------------------- |
| `slots`       | `ScheduleSlot[]` | Yes      | What the station runs: every slot that is not switched off                |
| `switchedOff` | `ScheduleSlot[]` | No       | Slots kept but not running, in the same order. Absent when there are none |

</details>
