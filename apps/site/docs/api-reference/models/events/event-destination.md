---
title: 'EventDestination'
sidebar_position: 1
mdx:
    format: 'md'
---

> Somewhere the station sends what happens on it: an operator's own server, sent a signed POST per event

<details>
<summary>Attributes (12)</summary>

| Attribute             | Type        | Required | Description                                                                                                                                              |
| --------------------- | ----------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                  | `string`    | Yes      | _read-only_                                                                                                                                              |
| `name`                | `string`    | Yes      | What the operator calls it                                                                                                                               |
| `url`                 | `string`    | Yes      | Where events are POSTed. http or https, and allowed to be on the station's own network. A redirect is never followed                                     |
| `enabled`             | `boolean`   | Yes      | Off sends nothing                                                                                                                                        |
| `events`              | `string[]`  | Yes      | The event types it is sent, from `/events/types`. Empty means every type, including any added later                                                      |
| `consecutiveFailures` | `number`    | Yes      | Deliveries in a row that did not arrive. Any delivery that arrives sets it back to nothing; at twenty the station turns the destination off. _read-only_ |
| `disabledReason`      | `'failing'` | No       | Set when the station turned it off itself, because it kept failing. Turning it back on clears this and the count. _read-only_                            |
| `lastDeliveredAt`     | `string`    | No       | _read-only_                                                                                                                                              |
| `lastFailedAt`        | `string`    | No       | _read-only_                                                                                                                                              |
| `lastFailure`         | `string`    | No       | What went wrong last time, in the station's words. _read-only_                                                                                           |
| `createdAt`           | `string`    | Yes      | _read-only_                                                                                                                                              |
| `updatedAt`           | `string`    | Yes      | _read-only_                                                                                                                                              |

</details>
