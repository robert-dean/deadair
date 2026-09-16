---
'@deadair/api': minor
'@deadair/web': minor
'@deadair/sdk': minor
'@deadair/android': patch
'@deadair/desktop': patch
---

The persona flag that says who the station's own host is has been renamed from `active` to `defaultHost`, everywhere: the `personas.default_host` column (migration 0031, applied at boot), the `Persona` contract and all four SDKs, and `PUT /personas/{id}/active`, which is now `PUT /personas/{id}/default-host`. Nothing about who presents changes; the old name said "on air", which it never meant during a broadcast that named its own host, and the console badged the wrong character for exactly that reason. The Personas page button now reads **Make station host** rather than "Put on air", and the desk's persona pickers mark whoever is actually presenting. The operator desk on macOS follows the same rename, and its Voice page lamp now marks the character presenting rather than the station's own host.
