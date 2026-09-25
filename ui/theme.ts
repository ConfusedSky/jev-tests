import { useEffect, useState } from "react";
import { useStored } from "./util";

export type Theme = "system" | "light" | "dark";
export const THEMES: Theme[] = ["system", "light", "dark"];

export const isDark = (theme: Theme, systemDark: boolean) => (theme === "system" ? systemDark : theme === "dark");

/** The theme after this one, as a toggle cycles them. */
export const nextTheme = (t: Theme): Theme => THEMES[(THEMES.indexOf(t) + 1) % THEMES.length]!;

const QUERY = "(prefers-color-scheme: dark)";

/** The chosen theme and whether the page is dark now; index.html applies the stored choice before React does. */
export function useTheme(): { theme: Theme; setTheme: (t: Theme) => void; dark: boolean } {
  const [theme, setTheme] = useStored<Theme>("jev.theme", "system", true);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia(QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const on = () => setSystemDark(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const dark = isDark(theme, systemDark);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);
  return { theme, setTheme, dark };
}
