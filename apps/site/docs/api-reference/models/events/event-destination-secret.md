---
title: 'EventDestinationSecret'
sidebar_position: 5
mdx:
    format: 'md'
---

> The secret deliveries to a destination are signed with. Shown only when it is made, so keep it

<details>
<summary>Attributes (1)</summary>

| Attribute | Type     | Required | Description                                                                                                                               |
| --------- | -------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `secret`  | `string` | Yes      | Put this in the receiver. Each delivery carries `Deadair-Webhook-Signature: v1=<hex HMAC-SHA256 of "<Deadair-Webhook-Timestamp>.<body>">` |

</details>
