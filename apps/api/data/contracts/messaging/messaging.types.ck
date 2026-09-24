options {
    keys: {
        area: messaging
    }
}

contract MessagingLinkCode: { # A one-time code that links a chat account to the signed-in station account. Shown once: send it to the station's bot as `/link CODE` in a direct message
    code: string(min=6, max=16) # The code itself. Case does not matter when it is sent
    expiresAt: datetime # When the code stops working. A new code replaces any earlier one
}

contract MessagingLink: { # A chat account linked to the signed-in station account. Operator commands sent from it run with this account's permissions
    pluginId: string(max=200) # Which messaging plugin the chat account is on, for example `deadair.telegram`
    platformUserId: string(max=200) # The chat platform's own id for the person
    displayName: string(max=200) # What the chat platform called them when they linked
    createdAt: datetime # When the link was made
}

contract MessagingLinkList: { # Every chat account linked to the signed-in station account, newest first
    links: array(MessagingLink)
}
