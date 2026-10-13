---
'@deadair/api': minor
'@deadair/web': minor
'@deadair/sdk': minor
'@deadair/error-codes': minor
---

People: an admin invites somebody into the admin or listener role from Settings › People, and looks after everybody's account afterwards. An invitation is a single-use link for one address and one role (a week for a listener, two days for an admin), shown with a QR code to send however you like or emailed by the station when mail is set up. The link opens a page of its own where the person chooses a password and sets up an authenticator app or a passkey, and the account is made in one go; nothing happens until they press a button, so a mail scanner opening the link uses nothing up. Each person's entry shows how they sign in, where and when, and lets an admin change their role, sign them out everywhere, reset a lost second step (the person is emailed), or switch them off and back on. Nothing is ever deleted, an admin never changes anybody's address, nobody changes their own role, and the station always keeps an admin.

Passkeys work in the browser: enrol one under Sign-in and security, use it at the sign-in second step and to confirm a change, or sign in with one alone. A passkey is bound to the address the station is deployed at. The phone apps still use an authenticator.

Somebody without the admin role who signs in to the console sees their own account and how to listen, not the desk. A switched-off account is refused at sign-in with its own error code.
