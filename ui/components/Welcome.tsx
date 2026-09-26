import { PRICE } from "../labels";
import { KIND_HINTS } from "./Ask";

/** The page before any run: how to start, and a question of each kind to start from. */
export function Welcome({ onExample }: { onExample: (template: string) => void }) {
  const steps = [
    { n: "1", title: "Put PDFs on the shelf", body: "Add a folder, or a locate command such as plocate -i '*.pdf', in the sidebar. Nothing is read or sent until you ask." },
    { n: "2", title: "Ask in plain words", body: "The whole shelf, one PDF, or just the file names. jev reads the kind of answer off the wording." },
    { n: "3", title: "Read the page itself", body: "Every answer is a number, true or false, a passage or a table of the document's own text, with the page it stands on, highlighted." },
  ];
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        {steps.map((s) => (
          <div key={s.n} className="rounded-2xl border border-stone-200 bg-white p-5">
            <div className="mb-3 flex h-7 w-7 items-center justify-center rounded-full bg-teal-700 font-serif text-sm font-semibold text-white">{s.n}</div>
            <div className="font-medium text-stone-900">{s.title}</div>
            <div className="mt-1 text-sm leading-relaxed text-stone-600">{s.body}</div>
          </div>
        ))}
      </div>
      <div className="rounded-2xl border border-stone-200 bg-white">
        <div className="border-b border-stone-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-stone-800">What you get back depends on how you ask</h2>
          <p className="text-xs text-stone-500">Pick one to start a question from it, then fill in the gap.</p>
        </div>
        <ul>
          {KIND_HINTS.map((k) => (
            <li key={k.kind} className="border-b border-stone-100 last:border-0">
              <button
                onClick={() => onExample(k.template)}
                className="grid w-full grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-0.5 px-5 py-2.5 text-left text-sm hover:bg-teal-50/60 sm:grid-cols-[5.5rem_minmax(0,1fr)_auto]"
              >
                <span>
                  <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-800 ring-1 ring-teal-600/20">{k.kind}</span>
                </span>
                <span className="font-serif text-stone-800">{k.template}</span>
                <span className="col-start-2 text-xs text-stone-500 sm:col-start-auto sm:text-right sm:text-sm">{k.gives}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-center text-xs text-stone-500">
        Each question costs a fraction of a cent: jev charges {PRICE}. Every step's tokens show in the log. Press <kbd className="rounded bg-stone-200 px-1">/</kbd> to type a question, <kbd className="rounded bg-stone-200 px-1">?</kbd> for every shortcut.
      </p>
    </div>
  );
}
