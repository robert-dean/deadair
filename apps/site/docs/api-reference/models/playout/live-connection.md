---
title: 'LiveConnection'
sidebar_position: 17
mdx:
    format: 'md'
---

> What a presenter's encoder needs to connect to the live input. Carries the input's password

<details>
<summary>Attributes (4)</summary>

| Attribute  | Type     | Required | Description                                                                                                                         |
| ---------- | -------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `port`     | `number` | Yes      | The port the station's container publishes for it, as the station sees it. Mapped to another on the host, the encoder uses that one |
| `mount`    | `string` | Yes      | The mount to push to                                                                                                                |
| `user`     | `string` | Yes      | The user name to send. The input accepts any; this is the one encoders default to                                                   |
| `password` | `string` | Yes      | The input's password, which the station generated when it was first set up                                                          |

</details>
