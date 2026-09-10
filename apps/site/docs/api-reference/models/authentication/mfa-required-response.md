---
title: 'MfaRequiredResponse'
sidebar_position: 19
mdx:
    format: 'md'
---

> MFA-required arm of /auth/token response

<details>
<summary>Attributes (4)</summary>

| Attribute     | Type                   | Required | Description                                                                       |
| ------------- | ---------------------- | -------- | --------------------------------------------------------------------------------- |
| `result`      | `'mfa_required'`       | Yes      | Discriminator                                                                     |
| `challengeId` | `string`               | Yes      | The MFA challenge identifier — pass back as `mfa_challenge_id` on the proof grant |
| `expiresAt`   | `string`               | Yes      | When the MFA challenge expires                                                    |
| `factors`     | `MfaChallengeFactor[]` | Yes      | Eligible factors the SPA may use to complete the challenge                        |

</details>
