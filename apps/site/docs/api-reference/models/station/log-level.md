---
title: 'LogLevel'
sidebar_position: 1
mdx:
    format: 'md'
---

> Five values, where `PluginLogLevel` next door has four. The plugin enum is the narrower one on
> purpose — that is the vocabulary a plugin's own `PluginLogger` offers — while `api.log` is written
> by `DeadairLogger`, which tees every level the app-wide `Logger` has, `trace` included. Narrowing
> here would make a `trace` line unrepresentable in the type of the surface that reads the file it
> is in.

```typescript
type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';
```
