---
title: 'EventType'
sidebar_position: 12
mdx:
    format: 'md'
---

> One kind of event the station sends

<details>
<summary>Attributes (4)</summary>

| Attribute      | Type            | Required | Description                                                |
| -------------- | --------------- | -------- | ---------------------------------------------------------- |
| `type`         | `string`        | Yes      |                                                            |
| `description`  | `string`        | Yes      | When it is sent, and what its `data` holds                 |
| `subscribable` | `boolean`       | Yes      | False for the test event, which only a test delivery sends |
| `example`      | `EventEnvelope` | Yes      |                                                            |

</details>
