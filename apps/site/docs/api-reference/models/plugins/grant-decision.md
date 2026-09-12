---
title: 'GrantDecision'
sidebar_position: 20
mdx:
    format: 'md'
---

> What a plugin may do with a capability it asked for. Denied is the default and needs no row: a
> capability is refused until somebody allows it, so "never answered" and "refused" are one state

```typescript
type GrantDecision = 'allowed' | 'denied';
```
