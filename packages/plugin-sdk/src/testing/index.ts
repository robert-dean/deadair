/**
 * Test doubles for the plugin contract.
 *
 * A separate entry point (`@deadair/plugin-sdk/testing`) rather than part of the
 * package's main export, because this imports `vitest`: anything here would
 * otherwise be a runtime dependency of every plugin the station loads in
 * process.
 */

export * from './fake.plugin.host.js';
