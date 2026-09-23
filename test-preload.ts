// Extracted text and highlighted copies go to a scratch cache, never the user's.
const dir = `${process.env.TMPDIR ?? "/tmp"}/jev-test`;
await Bun.$`rm -rf ${dir}`.quiet();
process.env.XDG_CACHE_HOME = dir;
