---
title: Install on Unraid
description: From the Apps tab to a station that answers in your browser, step by step, on the full tag.
---

# Install on Unraid

By the end of this page the station is running on your Unraid server and you are signed in to its
console as the administrator. It takes about ten minutes, most of it the first boot.

This page follows one path: the `full` tag, which brings its own database and cache, on a server
reached on your own network. [On Unraid](../unraid.md) is the reference for every field in the form,
the other two tags, and a proxy in front.

**You need:** an Unraid server on `amd64` (there is no arm64 image yet), Community Applications
installed so the **Apps** tab exists, and a terminal on any machine. The Unraid web terminal will do.

## 1. Generate the two keys

Run both commands and keep the output somewhere safe. Both go in the form, and you will want the first
one again if you ever move the station.

```bash
openssl rand -hex 32
```

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 | base64 -w0
```

The first is the **Secret key**: it encrypts every credential the station stores. The second is the
**Session key**: it signs sign-ins. On macOS, drop the `-w0` from the second command.

## 2. Install the template

1. Open **Apps** and search for `deadair`.
2. Choose **Install**. Unraid opens the container's settings form, already filled in with the
   template's defaults.
3. Make **Repository** end in `:full`. If Unraid asks which tag to install, choose `full` there.
   Otherwise change the end of **Repository** from `:latest` to `:full`. The template's default is
   `latest`, which expects a database and cache you run yourself. Left on it with those fields empty,
   the first boot stops at `deadair: no database.`

![The top of the Add Container form, with the repository field holding the tag](/img/unraid/form.webp)
*Fig. 1. The top of the form, with **Repository** already changed to `:full`. The tag is the end of
**Repository**.*

## 3. Fill in the six required fields

Everything you need is in the **Basic view**. Leave the Advanced view closed.

| Field | Put in it |
| --- | --- |
| **WebUI** | Leave it at `8080` unless something else on the server already uses that port. |
| **Data** | Leave it at `/mnt/user/appdata/deadair`. |
| **Public address** | The address you will type into a browser to reach the station, such as `http://192.168.1.10:8080`. Use your server's own address and the WebUI port, with nothing after the port. |
| **Console address** | The same address again. |
| **Secret key** | The `openssl rand -hex 32` output from step 1. |
| **Session key** | The base64 output from step 1, all on one line. |

![The six required fields, filled in for a station reached at http://192.168.1.10:8080](/img/unraid/required.webp)
*Fig. 2. The six required fields. Your two keys go in the empty boxes.*

Set **Timezone** too, to where the station is, such as `America/New_York`. Leave every database and
cache field empty: on `full` they are not used.

**Get the two addresses right.** A wrong one still lets the console load, so the mistake hides until a
sign-in link or a Spotify authorization sends your browser somewhere that does not answer.
[Why](../unraid.md#the-ones-you-have-to-fill-in).

## 4. Start it and watch the first boot

1. Choose **Apply**. Unraid pulls the image and starts the container.
2. On the **Docker** tab, open the container's log from its icon.
3. Wait for the line `Boot complete`. The first boot applies the database schema and can take a few
   minutes. Later boots are quicker.

There is no permissions step: the container runs as 99:100, which already owns the appdata share.

## 5. Create the administrator

1. Open the **Public address** in a browser, or choose **WebUI** from the container's menu.
2. The console opens on **Set up deadair**. Enter an email address and a password and choose
   **Create administrator**.

That account is the only way in, so keep the password somewhere safe.

**You should now see** the console's Desk. The station is installed but has nothing to play yet.

## If it goes wrong

- **The container stops, and the log names a variable.** That field is empty in the form. It is
  usually one of the two keys.
- **The log says it cannot reach the database.** The tag is not `full`, or a database field has
  something in it. Empty them, or see [On Unraid](../unraid.md) for `latest`.
- **The console loads but a sign-in link goes nowhere.** Fix **Public address** and **Console
  address**, then restart the container.

[On Unraid § When it will not start](../unraid.md#when-it-will-not-start) has the rest.

## Next

[Your first hour on air](./first-hour.md): give the station music, say who it is, and put something on.
