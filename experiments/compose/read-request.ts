// Reads a table request as compose.ts does, printing what it took the rows,
// columns and keep to be: bun experiments/compose/read-request.ts "question"
import { readRequest } from "../../compose";
import { DEFAULT_MODEL, makeClient } from "../../shared";
console.log(JSON.stringify(await readRequest(await makeClient(DEFAULT_MODEL), process.argv[2]!)));
