---
title: 'FactorChallengeFidoStartResponse'
sidebar_position: 53
mdx:
    format: 'md'
---

> Response for a FIDO assertion challenge

<details>
<summary>Attributes (4)</summary>

| Attribute         | Type                                    | Required | Description                                                                    |
| ----------------- | --------------------------------------- | -------- | ------------------------------------------------------------------------------ |
| `method`          | `'fido'`                                | Yes      | Discriminator                                                                  |
| `fidoChallengeId` | `string`                                | Yes      | The FIDO-factor challenge id — echo back on the `fido` grant as `challenge_id` |
| `assertion`       | `FidoPublicKeyCredentialRequestOptions` | Yes      | WebAuthn assertion options for navigator.credentials.get                       |
| `expiresAt`       | `string`                                | Yes      | When the FIDO challenge expires                                                |

</details>
