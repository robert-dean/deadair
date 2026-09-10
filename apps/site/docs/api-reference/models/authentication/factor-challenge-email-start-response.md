---
title: 'FactorChallengeEmailStartResponse'
sidebar_position: 54
mdx:
    format: 'md'
---

> Response for an email one-time-code challenge

<details>
<summary>Attributes (3)</summary>

| Attribute          | Type      | Required | Description                                                                     |
| ------------------ | --------- | -------- | ------------------------------------------------------------------------------- |
| `method`           | `'email'` | Yes      | Discriminator                                                                   |
| `emailChallengeId` | `string`  | Yes      | The email-factor challenge id — echo back on the `code` grant as `challenge_id` |
| `expiresAt`        | `string`  | Yes      | When the email challenge expires                                                |

</details>
