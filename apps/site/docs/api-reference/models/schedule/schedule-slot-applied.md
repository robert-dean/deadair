---
title: 'ScheduleSlotApplied'
sidebar_position: 9
mdx:
    format: 'md'
---

> What applying a slot to the show on air changed now, and what waits for the slot's next occurrence

<details>
<summary>Attributes (3)</summary>

| Attribute    | Type                 | Required | Description                                                                                                                                                                                                           |
| ------------ | -------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `applied`    | `ScheduleSlotPart[]` | Yes      | The parts the show on air follows from now on. Empty when it already matched the slot                                                                                                                                 |
| `waiting`    | `ScheduleSlotPart[]` | Yes      | The parts that differ from the show on air and cannot change mid-show: its source, mode and end make a different programme, and its co-hosts are settled for the night. They apply the next time the slot comes round |
| `replanning` | `boolean`            | Yes      | Whether the records still planned are being chosen again against the new programme. The ones already planned keep playing until the new set is ready, so nothing goes quiet while it is chosen                        |

</details>
