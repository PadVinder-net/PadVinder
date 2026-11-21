/**
 * The CalVer version of this build (`YYYY.N.P`): `PADVINDER_APP_VERSION`, else the `version` in
 * `package.json`, set at build time.
 */
export const APP_VERSION: string = __APP_VERSION__;
/** The CI run number of this build, from `PADVINDER_BUILD_NUMBER`; `dev` outside CI. */
export const APP_BUILD: string = __APP_BUILD__;
