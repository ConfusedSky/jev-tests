/** The page's address names the run on screen, so a reload and the back button land on it. */
export const runInHash = (hash: string): string | undefined => /^#run=([\w-]+)$/.exec(hash)?.[1];

/** The hash for a run, or none for the welcome page. */
export const hashFor = (id: string | undefined): string => (id ? `#run=${id}` : "");

/** Whether going to `url` from `href` changes the address, so a history entry is worth pushing. */
export const moves = (url: string, href: string) => new URL(url, href).href !== href;
