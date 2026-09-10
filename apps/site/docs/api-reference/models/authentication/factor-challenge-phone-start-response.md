---
title: 'FactorChallengePhoneStartResponse'
sidebar_position: 52
mdx:
    format: 'md'
---

> Response for a phone SMS challenge

<details>
<summary>Attributes (4)</summary>

| Attribute          | Type      | Required | Description                                                                     |
| ------------------ | --------- | -------- | ------------------------------------------------------------------------------- |
| `method`           | `'phone'` | Yes      | Discriminator                                                                   |
| `transport`        | `'sms'`   | Yes      | Echo of the chosen delivery channel                                             |
| `phoneChallengeId` | `string`  | Yes      | The phone-factor challenge id — echo back on the `code` grant as `challenge_id` |
| `expiresAt`        | `string`  | Yes      | When the phone challenge expires                                                |

</details>
