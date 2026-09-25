---
'@deadair/android': patch
---

The app no longer freezes when the system's media controls, Android Auto or a Bluetooth head unit connects to it. The library root is now answered at once instead of after a settings read that could never finish while the connection held the main thread.
