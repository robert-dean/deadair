---
title: 'FactorChallengeEmailStart'
sidebar_position: 50
mdx:
    format: 'md'
---

> Issue an email one-time-code challenge during a pending MFA round. Always a code: a magic link cannot complete an MFA round, since the `code` grant that redeems one takes `code(min=6, max=10)` and a link token is 43 characters

<details>
<summary>Attributes (2)</summary>

| Attribute          | Type      | Required | Description                                               |
| ------------------ | --------- | -------- | --------------------------------------------------------- |
| `method`           | `'email'` | Yes      | Discriminator                                             |
| `mfa_challenge_id` | `string`  | Yes      | The MFA challenge to which this factor challenge is bound |

</details>
