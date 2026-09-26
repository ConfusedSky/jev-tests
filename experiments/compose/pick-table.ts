// Which of CPR p.95's two tables pickTable takes for the rows, over several
// readings of the rows' name: bun experiments/compose/pick-table.ts [runs]
import { pickTable, type Found } from "../../compose";
import { DEFAULT_MODEL, makeClient } from "../../shared";
const client = await makeClient(DEFAULT_MODEL);
const t = (heads: string[], names: string[]): Found => ({ heads, rows: names.map((n) => ({ cells: [n], lines: [] })), hit: {} as Found["hit"] });
const standard = t(
  ["Weapon Type", "Weapon Skill", "Single Shot Damage", "Standard Magazine", "Rate of Fire", "Hands Required", "Can be Concealed?", "Cost"],
  ["Medium Pistol", "Heavy Pistol", "Very Heavy Pistol"],
);
const exotic = t(["Weapon", "Description and Data", "Cost"], ["Air Pistol", "Battleglove", "Constitution Arms Hurricane Assault Weapon"]);
const question = "Show me the standard weapon table. In addition to the normal columns add the extended magazine size";
const runs = Number(process.argv[2] ?? 5);
for (const things of ["weapon", "standard weapon"])
  for (const tables of [[standard, exotic], [exotic, standard]]) {
    const picks = await Promise.all(Array.from({ length: runs }, () => pickTable(client, question, things, tables)));
    console.log(`${things.padEnd(16)} ${tables[0] === standard ? "standard first" : "exotic first  "}  standard ${picks.filter((p) => p === standard).length}/${runs}`);
  }
