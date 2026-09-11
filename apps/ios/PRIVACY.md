# Privacy policy for deadair for iPhone

Last updated: 11 September 2026

deadair for iPhone is published by Marooned Software. It is a listening app for a deadair radio
station, which is server software that its users run themselves.

## What the app collects

Nothing. The app has no analytics, no advertising, no crash reporting, and no third-party
components that gather data. Marooned Software receives no information from it at all.

Listening needs no account. The app can optionally sign in to a station, which lets it read more of
what that station publishes about itself than the public stream carries. That is a sign-in to that
station alone, never to Marooned Software or to any service of ours.

## What the app stores on your iPhone

A handful of settings, in the app's own storage on the device:

- the address of the station you chose to listen to, and the name it gave when the app checked it
- which audio format you picked

These are part of the device's own backup, like any app's settings, and go nowhere else.

And, only if you sign in, the session that station issued, kept in the iPhone's Keychain:

- the email address you signed in with, so the app can show you which account it is using
- the two tokens the station gave it, which are what later requests to that station are made with
- which roles that station reports for your account (an operator, or only a listener), so the app
  knows which controls to show you

The Keychain item is marked as belonging to this device only, so it is not included in a backup and
does not move to a new iPhone. Your password is not stored. It is sent to the station once, in
exchange for those tokens, and is not kept afterwards. Nor is the one-time code, when the station
asks for one. The session is removed when you sign out and when you point the app at a different
station. None of it is transmitted to Marooned Software.

## What the app connects to

Only the station address you enter, and whatever that station's own responses point at.

That address is a server operated by you or by whoever runs the station you are listening to. It is
not operated by Marooned Software. Because it is an ordinary network connection, that server can see
your device's IP address, the requests the app makes, and the identifier the app sends to describe
itself. deadair station software uses this to count how many people are listening. What the operator
of a given station does with it is governed by that operator, not by this app.

Cover art is a second case worth naming. A station may answer with artwork it holds itself, in which
case the image comes from that same server. It may instead answer with a link to an image elsewhere,
such as a music provider's image host, in which case the app fetches the image from there and that
host sees the request. The app follows only the links the station gives it, and it sends no
information of yours when it does.

## Permissions

If the station you enter is on your own network, iOS asks whether the app may find and connect to
devices on your local network. That is the only permission the app asks for, and it is used to reach
that station and nothing else. The app also plays audio in the background, which iOS allows without
asking. Neither is used to collect information.

## Children

The app is not directed at children and collects no data from anyone.

## Changes

If this policy changes, the revised version will be posted here with a new date.

## Contact

ios@deadair.radio
