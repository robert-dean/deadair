---
title: 'OAuthClientAuthMethod'
sidebar_position: 9
mdx:
    format: 'md'
---

> How the app proves itself at the token endpoint. `none` is a public client, which is what apps on somebody's own device are

```typescript
type OAuthClientAuthMethod = 'none' | 'client_secret_post' | 'client_secret_basic';
```
