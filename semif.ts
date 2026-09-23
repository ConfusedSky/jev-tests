import type { TypeSafeClient } from "@typesafe-ai/sdk";

/**
 * A client for semif/server.py, an open model standing in for jev. It takes
 * the same systemOne request and returns the same answers, so nothing above
 * this line knows which is answering. Requests go one at a time: the server
 * holds one model and one GPU.
 */
export function makeSemifClient(url: string): TypeSafeClient {
  let queue: Promise<unknown> = Promise.resolve();
  const systemOne = async (request: { state: unknown; questions: Record<string, unknown> }) => {
    const turn = queue.then(async () => {
      const res = await fetch(url, { method: "POST", body: JSON.stringify(request) });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(`semif: ${body.error ?? res.statusText}`);
      return body;
    });
    queue = turn.catch(() => {});
    return turn;
  };
  return { systemOne } as unknown as TypeSafeClient;
}
