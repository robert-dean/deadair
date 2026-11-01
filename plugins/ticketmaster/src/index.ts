import { definePlugin } from '@deadair/plugin-sdk';
import { TicketmasterPlugin, ticketmasterManifest } from './ticketmaster.plugin.js';

export { TicketmasterPlugin, ticketmasterManifest };

export default definePlugin(ticketmasterManifest, () => new TicketmasterPlugin());
