---
title: 'StationBreakRequest'
sidebar_position: 24
mdx:
    format: 'md'
---

> What the station made of a request to say something

<details>
<summary>Attributes (5)</summary>

| Attribute   | Type      | Required | Description                                                                                                                                                                                              |
| ----------- | --------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `accepted`  | `boolean` | Yes      | False is an ordinary answer rather than a failure: breaks are off, there is no voice, nothing on this station writes that kind, the same request was taken moments ago, or the running order has no room |
| `requestId` | `string`  | No       | The request as it was written down. Present whenever accepted                                                                                                                                            |
| `segmentId` | `string`  | No       | The break it became. Present whenever accepted. Accepted is not aired: a bulletin with no story left unread is still passed over when it is written                                                      |
| `atIndex`   | `number`  | No       | Where it went in the running order. Absent for `interrupt` and `next`, which take a place only once their audio exists                                                                                   |
| `reason`    | `string`  | No       | Why it was declined, in the station's own words                                                                                                                                                          |

</details>
