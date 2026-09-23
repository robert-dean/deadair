---
title: 'OidcFactorRegistrationResponse'
sidebar_position: 78
mdx:
    format: 'md'
---

<details>
<summary>Attributes (3)</summary>

| Attribute      | Type     | Required | Description                                                                                             |
| -------------- | -------- | -------- | ------------------------------------------------------------------------------------------------------- |
| `method`       | `'oidc'` | Yes      | The method of the factor                                                                                |
| `authorizeUrl` | `string` | Yes      | Where to send the browser. The provider sends it back to Security, with `?linked=<provider>` on success |
| `expiresAt`    | `string` | Yes      | When the link attempt expires if the provider has not answered                                          |

</details>
