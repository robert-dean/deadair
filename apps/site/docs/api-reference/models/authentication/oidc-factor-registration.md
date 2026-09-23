---
title: 'OidcFactorRegistration'
sidebar_position: 70
mdx:
    format: 'md'
---

> Link an identity provider to the signed-in account. Answered with the provider's address; the browser goes there and comes back to Security

<details>
<summary>Attributes (2)</summary>

| Attribute  | Type           | Required | Description                                                        |
| ---------- | -------------- | -------- | ------------------------------------------------------------------ |
| `method`   | `'oidc'`       | Yes      | The method of the factor                                           |
| `provider` | `OidcProvider` | Yes      | The provider to link, as `GET /auth/login/oidc/providers` names it |

</details>
