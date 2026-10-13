---
title: People
sidebar_position: 11.2
description: Inviting somebody to an account, as an admin who runs the station or as a listener, what they set up when they accept, and looking after everybody's account afterwards.
---

A station has one account to begin with, the admin you made when you set it up. **Settings → People** is where you give other people accounts: another admin to run the station with you, or a listener who wants to ask for records and read the words from the phone apps. Listening itself needs no account at all; see [listening](./listening.md).

## The two roles

Everybody with an account holds exactly one role.

- **Admin** runs the station: everything in the console is theirs to change.
- **Listener** listens, asks for records and reads the words of what is playing, from the [phone and desktop apps](./listening.md). A listener who signs in to the console sees only their own account and how they sign in, never the desk.

You can change somebody's role at any time from their entry in People. Nobody can change their own, and the station always keeps at least one admin.

## Inviting somebody

Under **Invite somebody**, enter their address, choose a role and press **Create invitation**. The station makes a link for that one address and that one role:

- It works **once**. Whoever opens it first makes the account.
- It lasts **a week** for a listener and **two days** for an admin.
- It names the address. The person cannot change it while accepting, and only they can add another afterwards.

Then get the link to them. Press **Link** to see it with a QR code, and send it however suits you: a text, a chat, or the code on your screen across a room. Turn on **Email it to them** and the station emails the link itself, which needs a mail server under **Settings → Mail**. It is on by default for an admin, whose link is better in their own inbox than on a screen.

An admin's link waits for a second press before the console shows it, because whoever opens it first can change everything on the station. Send it to them alone.

If the console is open at `localhost`, it says so beside the link: nobody else can reach that address, so open the console at the station's own address before you send anything.

**Send again** makes a new link for the same address and role, and the old one stops working; use it for a link that ran out or was lost. **Withdraw** stops a link working at once. Nothing is deleted either way: every invitation stays in the list with where it stands, so the list is also a record of who invited whom.

## Accepting an invitation

The link opens a page of its own, not the console. Nothing happens until the person presses **Accept the invitation**, so a mail scanner or a chat app's link preview that opens the link uses nothing up.

They see the station's name, the role, and the address they were invited at. They choose a password, and a **second step**:

- **An authenticator app**, which shows a six-digit code. This is the one the phone apps ask for.
- **A passkey**: Touch ID, Face ID, Windows Hello, their phone or a security key. One touch, but in a browser only, so somebody who will use the phone apps should choose an authenticator, or add both.

The account is made in one go at the very end. Leaving half way saves nothing and the link still works; a wrong code saves nothing either.

A listener then gets a button that adds the station to the deadair app on that device, and the stream to listen to in the browser. An admin gets the way to the console.

## Looking after people

Every account is listed under People with its role, when it last signed in, whether it has an authenticator or passkey, and whether it is switched off. It opens on the active ones; use the filters to see the rest. Each person's entry shows how they sign in, where they are signed in now, and their recent sign-ins, and offers:

- **Role**, to change it.
- **Sign out everywhere**, which ends every session they have. They can sign straight back in.
- **Reset second step**, for somebody who has lost their phone or security key. Their authenticator apps and passkeys are removed and they are signed out. They sign in with their password and set up a new one from their own **Sign-in and security** page. When mail is set up, the station emails them to say it happened, so a reset nobody asked for is noticed.
- **Switch off**, which signs them out everywhere and stops them signing in. Their API keys, connected apps and chat links stop working too. Nothing is deleted: **Switch on** brings all of it back.

You cannot switch yourself off, and the last admin cannot be switched off. Each of these asks you to confirm it is you first, with your own authenticator or passkey, if you have not done so in the last few minutes.

An admin never changes somebody else's address. Only the person can, from their own Sign-in and security page.
