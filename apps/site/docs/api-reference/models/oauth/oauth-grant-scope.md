---
title: 'OAuthGrantScope'
sidebar_position: 8
mdx:
    format: 'md'
---

> What a connected app may do on the station. `view` reads it; `manage` changes it and includes `view`. Never more than the person approving it may do

```typescript
type OAuthGrantScope = 'view' | 'manage';
```
