---
title: 'ProviderMode'
sidebar_position: 12
mdx:
    format: 'md'
---

> Whether a capability has ONE answer or is asked of everything in turn. `one` stores a plugin id
> and `ordered` stores a list of them; see `plugins/plugin.providers.ts`, which both this and the
> station read the pairing from

```typescript
type ProviderMode = 'one' | 'ordered';
```
