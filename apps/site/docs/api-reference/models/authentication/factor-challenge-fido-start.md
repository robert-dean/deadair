---
title: 'FactorChallengeFidoStart'
sidebar_position: 49
mdx:
    format: 'md'
---

> Issue a WebAuthn assertion challenge during a pending MFA round

<details>
<summary>Attributes (2)</summary>

| Attribute          | Type     | Required | Description                                               |
| ------------------ | -------- | -------- | --------------------------------------------------------- |
| `method`           | `'fido'` | Yes      | Discriminator                                             |
| `mfa_challenge_id` | `string` | Yes      | The MFA challenge to which this factor challenge is bound |

</details>
