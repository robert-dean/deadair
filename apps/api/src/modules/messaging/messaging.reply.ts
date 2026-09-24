import { CommsError, type OutgoingMessage, type Reply, type TemplateRegistry } from '@maroonedsoftware/comms';
import type { Logger } from '@maroonedsoftware/logger';
import type { InboundMessage } from '@deadair/plugin-sdk';
import type { MessagingService } from './messaging.service.js';

/**
 * A `comms` `Reply` bound to the chat one message came from, speaking through its messaging plugin.
 *
 * Threaded under the message in a group, where several people may be asking at once, and not in a
 * direct chat, where quoting somebody's own message back to them is noise. A `subject` becomes the
 * first line, since no platform here has a separate field for one. A template renders natively only
 * where a plugin could take a native payload, and none can yet (the capability carries plain text and
 * buttons), so `sendNative` refuses and a template falls back to its portable form.
 *
 * Sending never throws for a refusal: the plugin has said what happened, and one chat the station
 * could not answer must not stop it hearing the next.
 */
export function replyTo(messaging: MessagingService, templates: TemplateRegistry, logger: Logger, pluginId: string, message: InboundMessage): Reply {
    const send = async (outgoing: OutgoingMessage): Promise<void> => {
        const text = outgoing.subject === undefined || outgoing.subject === '' ? outgoing.text : `${outgoing.subject}\n${outgoing.text}`;
        const result = await messaging.send(pluginId, {
            chatId: message.chatId,
            text,
            ...(message.chatKind === 'group' ? { replyToId: message.id } : {}),
            ...(outgoing.buttons === undefined || outgoing.buttons.length === 0
                ? {}
                : {
                      buttons: outgoing.buttons.map(button => ({
                          id: button.id,
                          label: button.label,
                          ...(button.value === undefined ? {} : { value: button.value }),
                      })),
                  }),
        });
        if (!result.delivered) logger.info(`messaging: could not answer on ${pluginId} (${result.reason ?? 'no reason given'})`);
    };

    const sendNative = async (): Promise<void> => {
        throw new CommsError(`the ${pluginId} plugin takes plain text and buttons, not a native payload`);
    };

    return {
        channel: pluginId,
        send,
        sendNative,
        sendTemplate: async (name, data) => {
            const rendered = templates.render(name, pluginId, data);
            if (rendered === undefined) throw new CommsError(`no template called ${name}`);
            if (rendered.kind === 'portable') return send(rendered.message);
            return sendNative();
        },
    };
}
