---
title: 'PlayoutLive'
sidebar_position: 15
mdx:
    format: 'md'
---

> The live input, as the audio chain last reported it

<details>
<summary>Attributes (3)</summary>

| Attribute | Type        | Required | Description                                                                                 |
| --------- | ----------- | -------- | ------------------------------------------------------------------------------------------- |
| `state`   | `LiveState` | Yes      |                                                                                             |
| `inMs`    | `number`    | No       | While `preroll`, how long until the presenter is on the air. What a countdown is drawn from |
| `forMs`   | `number`    | No       | While `onair`, how long the presenter has been on                                           |

</details>
