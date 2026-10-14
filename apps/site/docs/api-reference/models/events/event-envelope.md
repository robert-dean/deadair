---
title: 'EventEnvelope'
sidebar_position: 11
mdx:
    format: 'md'
---

> One event, as a destination receives it. The same shape for every type: read `type`, then `data`

<details>
<summary>Attributes (5)</summary>

| Attribute    | Type                      | Required | Description                                                             |
| ------------ | ------------------------- | -------- | ----------------------------------------------------------------------- |
| `id`         | `string`                  | Yes      | The event's own id. A redelivery of the same event carries the same one |
| `type`       | `string`                  | Yes      | What happened, such as `track.started`                                  |
| `occurredAt` | `string`                  | Yes      | When, as an ISO-8601 instant in UTC                                     |
| `station`    | `EventStation`            | Yes      |                                                                         |
| `data`       | `Record<string, unknown>` | Yes      | What the type says it holds. `/events/types` gives an example of each   |

</details>
