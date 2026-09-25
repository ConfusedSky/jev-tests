import { Dialog } from "./Dialog";

export const SHORTCUTS: { keys: string[]; does: string }[] = [
  { keys: ["/"], does: "Type a question" },
  { keys: ["⏎"], does: "Ask; ⇧⏎ for a new line" },
  { keys: ["esc"], does: "Stop the run, or close this" },
  { keys: ["ctrl", "K"], does: "Command palette: actions, PDFs, past runs" },
  { keys: ["["], does: "Older run" },
  { keys: ["]"], does: "Newer run" },
  { keys: ["b"], does: "Show or hide the sidebar" },
  { keys: ["?"], does: "This sheet" },
];

export function Shortcuts({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Keyboard shortcuts" onClose={onClose}>
      <div className="flex items-center justify-between border-b border-stone-100 px-5 py-3">
        <h2 className="text-sm font-semibold text-stone-800">Keyboard shortcuts</h2>
        <button onClick={onClose} aria-label="Close" className="rounded-md px-2 text-stone-400 hover:text-stone-700">
          ×
        </button>
      </div>
      <dl className="px-5 py-3">
        {SHORTCUTS.map((s) => (
          <div key={s.does} className="flex items-center gap-4 py-1.5">
            <dt className="flex w-24 shrink-0 gap-1">
              {s.keys.map((k) => (
                <kbd key={k} className="rounded border border-stone-300 bg-stone-50 px-1.5 py-0.5 font-mono text-[11px] text-stone-700">
                  {k}
                </kbd>
              ))}
            </dt>
            <dd className="text-sm text-stone-700">{s.does}</dd>
          </div>
        ))}
      </dl>
      <p className="border-t border-stone-100 px-5 py-2 text-[11px] text-stone-400">Each run has its own address, so the browser's back and forward move between them.</p>
    </Dialog>
  );
}
