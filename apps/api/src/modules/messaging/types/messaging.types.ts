import { z } from 'zod';
import { DateTime } from 'luxon';

const _ZodDatetime = z.preprocess(
    val => (typeof val === 'string' ? DateTime.fromISO(val) : val),
    z.custom<DateTime>(val => val instanceof DateTime && val.isValid, { message: 'Must be in ISO 8601 format' }),
);

/**
 * A one-time code that links a chat account to the signed-in station account. Shown once: send it to the station's bot as `/link CODE` in a direct message
 * generated from [MessagingLinkCode](../../../../data/contracts/messaging/messaging.types.ck#L7)
 */
export const MessagingLinkCode = z.strictObject({
    code: z.string().min(6).max(16).describe('The code itself. Case does not matter when it is sent'),
    expiresAt: _ZodDatetime.describe('When the code stops working. A new code replaces any earlier one'),
});
export type MessagingLinkCode = z.infer<typeof MessagingLinkCode>;

/**
 * A chat account linked to the signed-in station account. Operator commands sent from it run with this account's permissions
 * generated from [MessagingLink](../../../../data/contracts/messaging/messaging.types.ck#L12)
 */
export const MessagingLink = z.strictObject({
    pluginId: z.string().max(200).describe('Which messaging plugin the chat account is on, for example `deadair.telegram`'),
    platformUserId: z.string().max(200).describe("The chat platform's own id for the person"),
    displayName: z.string().max(200).describe('What the chat platform called them when they linked'),
    createdAt: _ZodDatetime.describe('When the link was made'),
});
export type MessagingLink = z.infer<typeof MessagingLink>;

/**
 * Every chat account linked to the signed-in station account, newest first
 * generated from [MessagingLinkList](../../../../data/contracts/messaging/messaging.types.ck#L19)
 */
export const MessagingLinkList = z.strictObject({
    links: z.array(MessagingLink),
});
export type MessagingLinkList = z.infer<typeof MessagingLinkList>;
