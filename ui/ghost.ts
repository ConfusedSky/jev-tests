/**
 * The way out of what lies over the page: a popover, a dialog, the pages
 * pane. It is taken out at once, as if it had no way out, so focus, refs,
 * `inert` and state go as they always did; what plays the way out is a
 * picture of it, a copy laid where it stood that nothing can reach, removed
 * once it has played. What takes room in the page stays in it instead,
 * since the room it gives up is part of the motion (see ui/motion.ts).
 */
import type { RefObject } from "react";
import { leaveMs } from "./motion";

/** Of what was taken out together, only what no other of them holds: a dialog plays out once, whole, not once more for a list open inside it. */
export function outermost<T extends { contains(other: T): boolean }>(all: T[]): T[] {
  return all.filter((a) => !all.some((b) => b !== a && b.contains(a)));
}

type Picture = { of: HTMLElement; copy: HTMLElement; scrolled: [Element, number, number][] };

/** A copy of `el` laid where it stands, measured while it still does. */
function picture(el: HTMLElement): Picture {
  // The layout size, not the drawn one: a box still scaling in draws smaller, and a copy laid out narrower would wrap its text.
  const { left, top } = el.getBoundingClientRect();
  const width = el.offsetWidth;
  const height = el.offsetHeight;
  const copy = el.cloneNode(true) as HTMLElement;
  const from = [el, ...el.querySelectorAll("*")];
  const to = [copy, ...copy.querySelectorAll("*")];
  const scrolled: Picture["scrolled"] = [];
  from.forEach((o, i) => {
    const c = to[i]!;
    // Found by no id, and a copied radio joins no group of the real one's.
    c.removeAttribute("id");
    c.removeAttribute("name");
    if (o instanceof HTMLInputElement && c instanceof HTMLInputElement) {
      c.value = o.value;
      c.checked = o.checked;
    } else if (o instanceof HTMLTextAreaElement && c instanceof HTMLTextAreaElement) c.value = o.value;
    // Scrolling takes only in the page, so it is set once the copy is there.
    if (o.scrollTop || o.scrollLeft) scrolled.push([c, o.scrollTop, o.scrollLeft]);
  });
  Object.assign(copy.style, { position: "fixed", left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px`, right: "auto", bottom: "auto", margin: "0" });
  // A z-index ranks only within the layer around it, and the copy in the body has left every layer, so it takes the level of the outermost that sets one.
  let z = "";
  for (let a: HTMLElement | null = el; a && a !== document.body; a = a.parentElement) {
    const at = getComputedStyle(a).zIndex;
    if (at !== "auto") z = at;
  }
  if (z) copy.style.zIndex = z;
  copy.classList.add("ghost");
  copy.inert = true;
  copy.setAttribute("aria-hidden", "true");
  return { of: el, copy, scrolled };
}

function show({ copy, scrolled }: Picture) {
  document.body.append(copy);
  for (const [c, top, left] of scrolled) {
    c.scrollTop = top;
    c.scrollLeft = left;
  }
  setTimeout(() => copy.remove(), leaveMs());
}

let taken: Picture[] = [];

/** A ref for what lies over the page: once taken out, it plays the way out its `data-leave` names, as a picture. */
export function ghost(el: HTMLElement | null) {
  if (!el) return;
  return () => {
    if (!el.dataset.leave || leaveMs() === 0) return;
    // Pictured now, while it stands, and shown once the commit is done: by then it is gone and cannot be measured, and a ref let go by a render that removed nothing shows no picture.
    if (taken.push(picture(el)) > 1) return;
    queueMicrotask(() => {
      const gone = taken.filter((p) => !p.of.isConnected);
      taken = [];
      const top = outermost(gone.map((p) => p.of));
      for (const p of gone) if (top.includes(p.of)) show(p);
    });
  };
}

/** `ghost`, and `ref.current` kept on the element while it is there. Make it once per ref, with `useMemo`: a new function each render makes React let go and take up again every time. */
export const ghostOf = (ref: RefObject<HTMLElement | null>) => (el: HTMLElement | null) => {
  if (!el) return;
  ref.current = el;
  const away = ghost(el);
  return () => {
    // Only its own: another element sharing the ref may hold it by now.
    if (ref.current === el) ref.current = null;
    away?.();
  };
};
