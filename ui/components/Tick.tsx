import { cx } from "../util";

/** A figure that changes as a run goes: each new value comes up into its place. */
export function Tick({ children, className, title }: { children: string; className?: string; title?: string }) {
  return (
    <span key={children} title={title} className={cx("inline-block animate-tick", className)}>
      {children}
    </span>
  );
}
