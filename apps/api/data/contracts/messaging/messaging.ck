options {
    keys: {
        area: messaging
    }
    services: {
        MessagingLinksService: "#src/modules/messaging/messaging.links.service.js"
    }
    security: {
        # The floor for every operation here. A link exists to let a chat account run operator
        # commands, which only `platform.manage` may, so there is nothing for anybody else to link.
        # The service also refuses an API key: a key must not be able to hand a chat account the
        # powers of the account that owns it.
        policy: platform.manage
    }
}

operation /messaging/links: {
    get: { # The chat accounts linked to the signed-in account
        name: List messaging links
        service: MessagingLinksService.list
        response: {
            200: {
                application/json: MessagingLinkList
            }
        }
    }
}

operation /messaging/links/code: {
    post: { # A new one-time code for linking a chat account. It replaces any earlier code and stops working after ten minutes
        name: Create messaging link code
        service: MessagingLinksService.createCode
        response: {
            201: {
                application/json: MessagingLinkCode
            }
        }
    }
}

operation /messaging/links/{pluginId}/{platformUserId}: {
    params: {
        pluginId: string(max=200)
        platformUserId: string(max=200)
    }
    delete: { # Unlink a chat account. Its operator commands are refused from the next one on
        name: Remove messaging link
        service: MessagingLinksService.remove
        response: {
            204:
        }
    }
}
