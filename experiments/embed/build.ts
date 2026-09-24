import { index, type Book } from "./lib";
const books = (process.argv.slice(2).length ? process.argv.slice(2) : ["heart", "litm", "cpr", "fallout"]) as Book[];
for (const b of books) {
  const t = Date.now();
  const ix = await index(b, ["title", "page"]);
  console.error(`${b}: ${ix.pageChunks.items.length} page chunks, ${ix.titles.items.length} titles in ${((Date.now() - t) / 1000).toFixed(0)}s`);
}
for (const b of books) {
  const t = Date.now();
  await index(b, ["secpage"]);
  console.error(`${b}: secpage in ${((Date.now() - t) / 1000).toFixed(0)}s`);
}
