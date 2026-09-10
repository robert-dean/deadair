---
title: 'FactorChallengePhoneStart'
sidebar_position: 48
mdx:
    format: 'md'
---

> Issue a phone SMS challenge during a pending MFA round

<details>
<summary>Attributes (3)</summary>

| Attribute          | Type      | Required | Description                                               |
| ------------------ | --------- | -------- | --------------------------------------------------------- |
| `method`           | `'phone'` | Yes      | Discriminator                                             |
| `transport`        | `'sms'`   | Yes      | Delivery channel — only `sms` is supported in this phase  |
| `mfa_challenge_id` | `string`  | Yes      | The MFA challenge to which this factor challenge is bound |

</details>
