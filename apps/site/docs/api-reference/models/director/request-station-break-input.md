---
title: 'RequestStationBreakInput'
sidebar_position: 25
mdx:
    format: 'md'
---

> Ask the station to say something. The station decides where it goes, and may decline

<details>
<summary>Attributes (3)</summary>

| Attribute | Type                   | Required | Description                                                                                                                                                                                                                          |
| --------- | ---------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `kind`    | `RequestableBreakKind` | Yes      |                                                                                                                                                                                                                                      |
| `urgency` | `BreakUrgency`         | Yes      | _default: `next`_                                                                                                                                                                                                                    |
| `topic`   | `string`               | No       | What it is about, as a format clock band names it: a news category's key for a bulletin, a place's key for a forecast. A key that matches nothing is passed over when the break is written rather than read out under the wrong name |

</details>
