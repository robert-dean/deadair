import { AuthenticationFactorRouter } from './authentication.factor.router.js';
import { AuthenticationRouter } from './authentication.router.js';
import { AuthenticationSessionsRouter } from './authentication.sessions.router.js';
import { MusicRouter } from './music.router.js';
import { VendorsRouter } from './vendors.router.js';

export const routers = [AuthenticationRouter, AuthenticationFactorRouter, AuthenticationSessionsRouter, MusicRouter, VendorsRouter];
