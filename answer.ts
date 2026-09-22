import { choice, noul, type ChoiceResponse, type NoulResponse, type TypeSafeClient } from "@typesafe-ai/sdk";
import { timed } from "./shared";

export type Kind = "count" | "truth" | "passage";

/** What shape of answer the question wants, decided once from its wording. */
export async function classify(client: TypeSafeClient, question: string): Promise<Kind> {
  const res = await timed("api", () =>
    client.systemOne({
      state: { question },
      questions: {
        kind: choice("What shape of answer does this question want?", {
          count: "Asks how many, how much, or for some other number",
          truth: "States something that is either true or false, or asks whether something is the case",
          passage: "Asks what, how or why, and wants an explanation or the place it is written",
        }),
      },
    }),
  );
  return (res.answers.kind as ChoiceResponse).choice as Kind;
}

export type Answer = { text: string; p: number };

/** Jev writes no prose, so a count is a choice over the numbers themselves. */
async function countFrom(
  client: TypeSafeClient,
  question: string,
  section: string,
  text: string,
  max: number,
): Promise<Answer> {
  // A Choice takes at most 255 options: 0 through 252, plus the two escapes.
  const ceiling = Math.min(max, 252);
  const criteria: Record<string, string> = {};
  for (let i = 0; i <= ceiling; i++) criteria[String(i)] = `The answer is exactly ${i}`;
  criteria[`over ${ceiling}`] = `The answer is greater than ${ceiling}`;
  criteria["not stated"] = "The text does not give this number";

  const res = await timed("api", () =>
    client.systemOne({
      state: { question, section, text },
      questions: { count: choice("How many, according to the text?", criteria) },
    }),
  );
  const a = res.answers.count as ChoiceResponse;
  return { text: a.choice, p: (a.probabilities as Record<string, number>)[a.choice] ?? a.confidence };
}

async function truthFrom(
  client: TypeSafeClient,
  question: string,
  section: string,
  text: string,
): Promise<Answer> {
  const res = await timed("api", () =>
    client.systemOne({
      state: { question, section, text },
      questions: {
        truth: noul("The statement in the question is true according to the text", {
          true: "The text states this, using the same name or term the statement uses",
          false:
            "The text does not state this, contradicts it, or only names something whose name merely contains " +
            "the term in the statement. A longer name is a different thing: 'vermissian knight' is not 'knight', " +
            "and 'fire bolt' is not 'bolt'.",
        }),
      },
    }),
  );
  const p = (res.answers.truth as NoulResponse).noul;
  return { text: p >= 0.5 ? "true" : "false", p: p >= 0.5 ? p : 1 - p };
}

export async function answerFrom(
  client: TypeSafeClient,
  kind: Kind,
  question: string,
  section: string,
  text: string,
  countMax: number,
): Promise<Answer | undefined> {
  if (kind === "count") return countFrom(client, question, section, text, countMax);
  if (kind === "truth") return truthFrom(client, question, section, text);
  return undefined;
}
