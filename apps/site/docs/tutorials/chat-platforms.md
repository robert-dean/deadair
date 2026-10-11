---
title: Put the station on a chat platform
description: Give the station a bot on Telegram, Discord or Slack that says what is playing, takes requests and posts each record as it airs.
---

# Put the station on a chat platform

By the end of this page the station has a bot on Telegram, Discord or Slack. Anybody in the chats you
choose can ask it what is on air with `/now` and ask for a record with `/request`, it can post each
record to a channel as it goes to air, and your own chat account can skip a record or take the station
off the air.

[Plugins](../features/plugins.md#the-bundled-twenty-seven) says what each of the three chat plugins does
and why none of them needs a public address.

**You need** a station on air with music, signed in as an operator, and an account on the platform with
the right to add a bot: to a Telegram group, a Discord server, or a Slack workspace. The station does
not have to be reachable from the internet. It asks Telegram for messages, and holds a connection open
to Discord and Slack.

The steps are the same for each platform except the first. Do them once per platform you want.

## 1. Make the bot

Each plugin's settings open with a note saying how. In short:

**On Telegram** (the note is **Making a bot**):

1. Open a chat with @BotFather in Telegram and send `/newbot`.
2. Follow its steps. It answers with a token that looks like `123456789:AA…`. Keep it to yourself: it is
   the bot's password.
3. To have the bot answer in a group, add it to the group. Leave BotFather's privacy mode on if you want
   it to hear only commands there rather than every message.

**On Discord** (the note is **Making a bot**):

1. In the Discord Developer Portal, create an application and open its **Bot** page.
2. Reset the token and copy it.
3. On the same page, turn on the **Message Content Intent**. Without it the station cannot read a
   command typed as text.
4. Under **OAuth2**, pick the `bot` and `applications.commands` scopes, with the **Send Messages** and
   **Read Message History** permissions, and open the link it makes to add the bot to your server.

You do not register any slash commands: the station does that itself each time the plugin starts.

**On Slack** (the note is **Making an app**):

Slack will not let an app register its own slash commands, so they come in an app manifest. Follow
[Setting up Slack](../features/plugins.md#setting-up-slack), which has the manifest to paste and the
three steps after it. You come away with two tokens: the **Bot User OAuth Token** (starting `xoxb-`) and
an **App-Level Token** with the `connections:write` scope (starting `xapp-`). Invite the app to each
channel it should answer or announce in.

## 2. Turn on the plugin

Open **Settings → Plugins** and open **Telegram**, **Discord** or **Slack**.

1. Switch it on. The first time, the station asks **Enable Telegram?** (or Discord, or Slack) and
   explains that a plugin is trusted code. Press **Enable Telegram** to go on.
2. Paste the token into **Bot token**. On Slack, paste the second token into **App-level token** as
   well.
3. Leave **Answer direct messages** on for now. It decides whether the bot answers anybody who writes
   to it one to one, and linking your own account in step 6 needs it.
4. Press **Save configuration**.

Saving restarts the plugin with the new settings, so there is nothing else to restart. **You should
see** the plugin's status turn to **Active**. Send the bot `/now` in a direct message: it answers with
what is on air, such as `Now playing on Dead Air: Teardrop by Massive Attack (Mezzanine)`.

## 3. Choose where it answers

A bot only answers in the groups or channels you list. Anywhere else it stays quiet, and on Discord and
Slack a slash command there is answered with "The station is not listening in this channel.", which
only the person who typed it sees.

The field is **Groups to answer in** on Telegram and **Channels to answer in** on Discord and Slack. It
takes ids, one per line. To find one:

- **Any platform:** say `/now` to the bot in the group or channel. The station does not answer, but it
  writes a line to the plugin's log the first time somebody there speaks to it, saying the group or
  channel is not on the list and giving its id. Open the plugin's page, look under **Logs** (press
  **Refresh** if the line is not there yet), and copy the id.
- **Discord:** turn on Developer Mode in Discord's own settings, then right-click the channel and choose
  **Copy Channel ID**. It is a long number such as `1234567890123456789`.
- **Slack:** the id is at the bottom of the channel's **About** tab, such as `C0123456789`.

A Telegram group id is a negative number, such as `-1001234567890`.

Paste the ids into the field and press **Save configuration**.

## 4. Choose where it announces

To have the station post each record as it goes to air, fill in **Chats to announce in** on Telegram or
**Channels to announce in** on Discord and Slack, one per line:

- **Telegram:** a group id, or a channel's `@name`. For a channel, add the bot to it as an
  administrator first.
- **Discord:** a channel id. The bot has to be able to send messages there.
- **Slack:** a channel id, with the app invited to the channel.

Save. Leave the field empty and the station only speaks when spoken to.

**You should see** a line such as `Now playing on Dead Air: Teardrop by Massive Attack (Mezzanine)` in
each chat as the next record starts. Only records are announced: the station talking between them is
not.

## 5. Ask for a record

In a direct message, or in a group or channel you listed, send `/request` followed by a title, an
artist or both:

```
/request teardrop massive attack
```

When there is one clear match the station takes the request at once and says so, for example "Your
request is in" or "Got it". When several records match it asks "Which one did you mean?" with up to
three buttons; press one. Later it tells you what became of the request: placed, aired, or turned down
and why.

To dedicate it, add `for`, a name, a colon and a message:

```
/request teardrop for Sam: happy birthday
```

The presenter says the dedication in their own words just before the record. A chat request follows the
same rules as one from the app or a party: one waiting at a time per person, a wait between requests,
and nothing that has played recently.

`/help` lists everything the bot answers to.

## 6. Link your own chat account

Anybody can use `/now` and `/request`. The operator commands, `/skip`, `/offair` and `/onair`, only work
from a chat account linked to a station account that is allowed to run the station.

1. In the console, open **Settings → Sign-in and security**. Under **Your account**, find **Chat
   accounts** and press **Link a chat account**.
2. The card shows a command under **Send this to the station's bot**, such as `/link 4F7K2QHM`. Copy it.
3. Send it to the bot **in a direct message**, not a group. The code works once, for ten minutes.

The bot answers "Linked." and the card lists the account as your name on that platform. From then on:

- `/skip` skips what is playing.
- `/offair` takes the station off the air.
- `/onair` puts it back on the air where it stopped.

These run as your station account, so they can do only what you can do in the console, and they stop
working the moment your account loses that right. Send `/unlink` to the bot, or press **Unlink** on the
card, to undo it.

## If it goes wrong

- **The plugin says Misconfigured or Failed.** Its settings are incomplete or were refused. The plugin's
  page shows **Last error**, and the **Logs** card says more.
- **Discord: "Discord refused the Message Content Intent."** Turn on the Message Content Intent under
  Privileged Gateway Intents on the bot's page in the Developer Portal, then press **Save configuration**
  again. The plugin waits for a save before it tries again.
- **Discord: "Discord did not accept the bot token."** Reset the token on the Bot page, paste the new one
  and save.
- **The bot answers in a direct message but ignores a group or channel.** The group or channel is not
  listed, or the id is wrong. Step 3 shows how to read the id from the plugin's log.
- **"The station is not listening in this channel."** The same cause: list the channel.
- **The bot says nothing at all in a Telegram group.** Commands are answered there; anything else is
  ignored on purpose, because people in a group are talking to each other. Try `/now`.
- **Nothing is announced.** The record has to start after you saved. Check the announce field, that the
  bot is an administrator of a Telegram channel, and that the Slack app was invited to the channel.
- **"That code does not work."** A code lasts ten minutes and works once. Press **New code** on the card
  and send the new one.
- **"Link codes only work in a direct message to me."** You sent it in a group, so everybody there has
  seen it and it is used up. Get a new code and send it one to one.
- **"Only a station operator can do that."** Your chat account is not linked, or your station account
  cannot run the station. Link it as in step 6.
- **The bot does not answer direct messages.** **Answer direct messages** is off. Turn it on to link an
  account, then off again if you want a private station.

## Next

- [Throw a party](./throw-a-party.md) for requests from people in the room, with no chat account at all.
- [Plugins](../features/plugins.md) for what else the station can be connected to.
