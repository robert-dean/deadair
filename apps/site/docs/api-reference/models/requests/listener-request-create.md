---
title: 'ListenerRequestCreate'
sidebar_position: 8
mdx:
    format: 'md'
---

> Ask the station to play a record

<details>
<summary>Attributes (5)</summary>

| Attribute    | Type                | Required | Description                                                                                                                                                          |
| ------------ | ------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `trackId`    | `string`            | No       | A record from the request search that the station holds. Send this or `source`, never both                                                                           |
| `source`     | `RequestableSource` | No       | A record from the request search that a provider carries. The station takes it in, then decides on the request as usual                                              |
| `name`       | `string`            | No       | What the station should call you. Omitted, you are "a listener": your account's email address is never shown or read out                                             |
| `dedicateTo` | `string`            | No       | Dedicate it to somebody. The station may say this name on air                                                                                                        |
| `message`    | `string`            | No       | A few words to go with it. The presenter may put them in their own words on air, and leaves out anything unfit to broadcast; the words themselves are never read out |

</details>
