import { outline } from "../../pdf";
const F = (await outline(process.env.JEV_FALLOUT_PDF!)).filter((s) => s.path);
const C = await outline(process.env.JEV_CPR_PDF!);
await Bun.write(process.argv[2] + "/F.txt", F.map((s) => s.path).join("\n"));
await Bun.write(process.argv[2] + "/C.txt", C.map((s) => s.path).join("\n"));
