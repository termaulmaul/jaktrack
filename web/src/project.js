// The project's name and links, in ONE place: the page, the build, the data scripts and the live service read them
// from here (package.json carries the slug too). Renaming the project = change these lines + package.json "name".
export const APP_NAME = 'jaktrack';
export const APP_SLUG = 'jaktrack';
export const APP_TAGLINE = 'kereta Jakarta, menurut jadwal';
export const REPO_URL = 'https://github.com/termaulmaul/jaktrack';
export const DEMO_URL = '';
/** Honest User-Agent for every request our scripts and services make (name + where to read about the project). */
export const userAgent = (part = '', version = '1') => `${APP_SLUG}${part ? `-${part}` : ''}/${version} (+${REPO_URL})`;
