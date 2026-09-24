---
'@deadair/plugin-sdk': patch
'@deadair/api': patch
---

Plugins can open an outbound WebSocket with `host.socket`, for a platform that delivers over one. It answers to the same rules as `host.fetch`: the host must be in the plugin's network permissions, a connect counts against its rate limit, and the manifest has to declare the new `sockets` permission. The station closes every socket a plugin still holds when it is disabled or its settings are saved.
