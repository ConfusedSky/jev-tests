import { KIND_HINTS } from "./Ask";

export function Welcome() {
  const steps = [
    { n: "1", title: "Put PDFs on the shelf", body: "Add a folder, or a locate command such as plocate -i '*.pdf', on the left. Nothing is read or sent until you ask." },
    { n: "2", title: "Ask in plain words", body: "The whole shelf, one PDF, or just the file names. jev reads the kind of answer off the wording." },
    { n: "3", title: "Read the page itself", body: "Every answer is a number, true or false, a passage or a table of the book's own text, with the page it stands on, highlighted." },
  ];
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        {steps.map((s) => (
          <div key={s.n} className="rounded-2xl border border-stone-200 bg-white p-5">
            <div className="mb-3 flex h-7 w-7 items-center justify-center rounded-full bg-teal-700 font-serif text-sm font-semibold text-white">{s.n}</div>
            <div className="font-medium text-stone-900">{s.title}</div>
            <div className="mt-1 text-sm leading-relaxed text-stone-500">{s.body}</div>
          </div>
        ))}
      </div>
      <div className="rounded-2xl border border-stone-200 bg-white">
        <div className="border-b border-stone-100 px-5 py-3 text-sm font-semibold text-stone-800">What you get back depends on how you ask</div>
        <table className="w-full text-sm">
          <tbody>
            {KIND_HINTS.map((k) => (
              <tr key={k.kind} className="border-b border-stone-100 last:border-0">
                <td className="w-24 px-5 py-2.5">
                  <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-800 ring-1 ring-teal-600/20">{k.kind}</span>
                </td>
                <td className="py-2.5 font-serif text-stone-700">{k.says}</td>
                <td className="px-5 py-2.5 text-right text-stone-500">{k.gives}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-center text-xs text-stone-400">
        Each question costs a fraction of a cent: jev charges $0.042 per million tokens in. Every step's tokens show in the log. Press <kbd className="rounded bg-stone-200 px-1">/</kbd> to type a question, <kbd className="rounded bg-stone-200 px-1">?</kbd> for every shortcut.
      </p>
    </div>
  );
}
