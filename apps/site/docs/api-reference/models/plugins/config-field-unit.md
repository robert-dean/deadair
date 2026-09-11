---
title: 'ConfigFieldUnit'
sidebar_position: 4
mdx:
    format: 'md'
---

> What a `number` field's value is measured in. The stored value is always in this unit; only the
> control the operator touches changes, so a byte count stays a byte count everywhere it is read and
> a `fraction` stays the share between 0 and 1 that the code multiplying by it wants

```typescript
type ConfigFieldUnit = 'bytes' | 'fraction';
```
