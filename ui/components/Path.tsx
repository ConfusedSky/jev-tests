import { cx } from "../util";

/** A path cut in the middle when it does not fit, so the folder or file at its end stays in view. */
export function MiddlePath({ path, className }: { path: string; className?: string }) {
  const at = path.lastIndexOf("/");
  const [head, tail] = at > 0 ? [path.slice(0, at), path.slice(at)] : ["", path];
  return (
    <span className={cx("flex min-w-0", className)} title={path}>
      {head && <span className="truncate">{head}</span>}
      <span className="max-w-[85%] shrink-0 truncate">{tail}</span>
    </span>
  );
}
