---
title: 'AsRunEntry'
sidebar_position: 5
mdx:
    format: 'md'
---

> One line of what actually went out

<details>
<summary>Attributes (10)</summary>

| Attribute    | Type        | Required | Description                                                                                                                  |
| ------------ | ----------- | -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `id`         | `string`    | Yes      | Unique across the log, and half of the cursor below                                                                          |
| `kind`       | `AsRunKind` | Yes      |                                                                                                                              |
| `at`         | `string`    | Yes      | When it started. For an item, the moment the player said so, not when it was handed over                                     |
| `endedAt`    | `string`    | No       | When it stopped. Absent while an item is on air, and for one the station never saw end, such as the last item before a crash |
| `title`      | `string`    | No       | A record's title or a break's label, as it went out                                                                          |
| `artists`    | `string`    | No       | A record's credit as written, whole                                                                                          |
| `trackId`    | `string`    | No       | The catalog track a record was                                                                                               |
| `segmentId`  | `string`    | No       | The segment a break or a programme was                                                                                       |
| `passedOver` | `number`    | No       | How many items already handed to the player it moved past to reach this one. They never aired. Absent when none              |
| `detail`     | `string`    | No       | For a gap or an air change, the station's own sentence about it                                                              |

</details>
