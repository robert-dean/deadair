/**
 * The shortest password the station accepts, matching the auth contract's `string(min=8, max=256)`.
 *
 * One number for the three forms that ask for one (setting a password, the first admin account,
 * accepting an invitation), so a change to the contract is a change here rather than three. Each
 * form still says it in its own words.
 */
export const MIN_PASSWORD_LENGTH = 8;
