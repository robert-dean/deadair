---
'@deadair/api': minor
---

An app connected over MCP that searches the station's API with nothing in particular in mind now gets a map of it: every area (the running order, personas, playlists, playout and the rest) with how many operations each holds, instead of the first 25 operations in alphabetical order. It can then list one area, or narrow it with a few words. This takes effect once the station is built with a ContractKit release that reports each operation's area. Until then, searching with nothing lists operations as before.
