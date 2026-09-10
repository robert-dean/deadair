---
title: 'AuthSession'
sidebar_position: 58
mdx:
    format: 'md'
---

> Who the caller is, as the station sees them

<details>
<summary>Attributes (2)</summary>

| Attribute | Type             | Required | Description                                                                                                                                                   |
| --------- | ---------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `actorId` | `string`         | Yes      | The actor the session belongs to                                                                                                                              |
| `roles`   | `PlatformRole[]` | Yes      | Every platform role the caller holds, sorted. Empty for an account nobody has granted one, which today is any account that did not come in through onboarding |

</details>
