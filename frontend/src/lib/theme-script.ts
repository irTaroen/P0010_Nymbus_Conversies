/**
 * The pre-paint half of `lib/theme.ts`, kept out of that client module so the
 * (server) root layout can inline it. It sets `data-theme` on `<html>` from the
 * remembered choice, or the OS setting when there is none, before the body paints.
 */
export const THEME_STORAGE_KEY = "nymbus-theme";

export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t!=="light"&&t!=="dark"){t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.setAttribute("data-theme",t)}catch(e){document.documentElement.setAttribute("data-theme","light")}})()`;
