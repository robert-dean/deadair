---
'@deadair/api': minor
---

A station can now run plugins it did not ship with. Copy a plugin into `plugins/` on the data volume and press Rescan: the station lends it its own SDK, where before every such plugin failed to load. The console marks a plugin you installed, and one that failed to load names the folder it was read from. The plugin SDK is published to npm as `@deadair/plugin-sdk`, and deadair.radio has a new section on writing, testing and installing a plugin, walking through a complete example.
