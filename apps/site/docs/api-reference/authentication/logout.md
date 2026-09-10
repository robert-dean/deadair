---
title: 'Logout'
sidebar_label: 'Logout'
sidebar_position: 11
mdx:
    format: 'md'
---

revoke the caller's current session (self sign-out). Deliberately carries no policy gate: signing out must always clear the browser's httpOnly refresh cookie, including for a caller whose access token has already expired. A 401 here would leave a 30-day refresh cookie behind that silently signs the user back in on the next page load. SessionsService revokes the session only when the caller is actually authenticated; an anonymous caller still gets 204 and a cleared cookie.

**`POST`** `/auth/logout`

:::note
SDK method: `logout`
Security: public
:::

## Response

`204 No Content`
