import { DateTime } from 'luxon';
const __dt = (v: unknown, path: string): DateTime => {
    if (typeof v !== 'string') {
        throw new TypeError(`ContractKit: expected an ISO 8601 string at '${path}', received ${typeof v}.`);
    }
    const d = DateTime.fromISO(v);
    if (!d.isValid) throw new TypeError(`ContractKit: '${v}' at '${path}' is not a valid ISO 8601 datetime.`);
    return d;
};

/**
 * A one-time code that links a chat account to the signed-in station account. Shown once: send it to the station's bot as `/link CODE` in a direct message
 * generated from [MessagingLinkCode](../../../../../apps/api/data/contracts/messaging/messaging.types.ck#L7)
 */
export interface MessagingLinkCode {
    /** The code itself. Case does not matter when it is sent */
    code: string;
    /** When the code stops working. A new code replaces any earlier one */
    expiresAt: DateTime;
}

/** Rehydrates every wire-encoded scalar in a MessagingLinkCode into its runtime type. Mutates and returns `raw`. */
export function reviveMessagingLinkCode(raw: MessagingLinkCode): MessagingLinkCode {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0['expiresAt'] = __dt(__o0['expiresAt'], 'MessagingLinkCode.expiresAt');
    return raw;
}

/**
 * A chat account linked to the signed-in station account. Operator commands sent from it run with this account's permissions
 * generated from [MessagingLink](../../../../../apps/api/data/contracts/messaging/messaging.types.ck#L12)
 */
export interface MessagingLink {
    /** Which messaging plugin the chat account is on, for example `deadair.telegram` */
    pluginId: string;
    /** The chat platform's own id for the person */
    platformUserId: string;
    /** What the chat platform called them when they linked */
    displayName: string;
    /** When the link was made */
    createdAt: DateTime;
}

/** Rehydrates every wire-encoded scalar in a MessagingLink into its runtime type. Mutates and returns `raw`. */
export function reviveMessagingLink(raw: MessagingLink): MessagingLink {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0['createdAt'] = __dt(__o0['createdAt'], 'MessagingLink.createdAt');
    return raw;
}

/**
 * Every chat account linked to the signed-in station account, newest first
 * generated from [MessagingLinkList](../../../../../apps/api/data/contracts/messaging/messaging.types.ck#L19)
 */
export interface MessagingLinkList {
    links: MessagingLink[];
}

/** Rehydrates every wire-encoded scalar in a MessagingLinkList into its runtime type. Mutates and returns `raw`. */
export function reviveMessagingLinkList(raw: MessagingLinkList): MessagingLinkList {
    const __o0 = raw as unknown as Record<string, unknown>;
    {
        const __a1 = __o0['links'] as unknown[];
        for (let __i2 = 0; __i2 < __a1.length; __i2++) {
            reviveMessagingLink(__a1[__i2] as never);
        }
    }
    return raw;
}
