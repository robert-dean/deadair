---
title: 'EventDelivery'
sidebar_position: 7
mdx:
    format: 'md'
---

> One attempt at sending an event to a destination

<details>
<summary>Attributes (9)</summary>

| Attribute    | Type                                   | Required | Description                                                                                                          |
| ------------ | -------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------- |
| `id`         | `string`                               | Yes      |                                                                                                                      |
| `eventId`    | `string`                               | Yes      | The event's own id, which every attempt at it shares                                                                 |
| `eventType`  | `string`                               | Yes      |                                                                                                                      |
| `attempt`    | `number`                               | Yes      |                                                                                                                      |
| `outcome`    | `'delivered' \| 'failed' \| 'dropped'` | Yes      | `dropped` is an event no longer worth sending, such as a record that finished playing while its destination was down |
| `httpStatus` | `number`                               | No       | What the destination answered, when it answered at all                                                               |
| `durationMs` | `number`                               | Yes      |                                                                                                                      |
| `error`      | `string`                               | No       | What went wrong, in the station's words. Never the destination's response body                                       |
| `createdAt`  | `string`                               | Yes      |                                                                                                                      |

</details>
