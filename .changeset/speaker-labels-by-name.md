---
'@deadair/api': patch
---

When a model writes a break or a call-in turn as a script, with the speaker's name and a colon in front of it, the station now takes that label off before the voice reads it, whatever alphabet the name is in and however it is spaced: "Solène:" and "Iris : bonsoir" go as surely as "Host:". It recognises the label by who it names (the presenter, the station's presenter name, an outgoing host, or a production's cast) or by a role word like DJ or Presenter, so an opening that only looks like a label, such as "Tonight: Rain all week", is no longer cut.
