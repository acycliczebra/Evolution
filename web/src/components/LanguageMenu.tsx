import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";

/** Translate icon (文/A) in the header; the menu lists recently picked languages first. */
export function LanguageMenu() {
  const { lang, menu, setLang, t } = useI18n();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("click", close);
    document.addEventListener("keydown", key);
    list.current?.querySelector<HTMLElement>("[aria-selected=true]")?.focus();
    return () => { document.removeEventListener("click", close); document.removeEventListener("keydown", key); };
  }, [open]);

  const pick = (code: string) => { setLang(code); setOpen(false); };
  const move = (e: React.KeyboardEvent<HTMLLIElement>, code: string) => {
    const li = e.currentTarget;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(code); }
    if (e.key === "ArrowDown") { e.preventDefault(); (li.nextElementSibling as HTMLElement | null)?.focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); (li.previousElementSibling as HTMLElement | null)?.focus(); }
  };

  return (
    <div className="langmenu" ref={box}>
      <button
        className={`lang-btn${open ? " on" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${t("lang.label")}: ${lang.native}`}
        title={t("lang.label")}
        onClick={() => setOpen(o => !o)}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path fill="currentColor" d="m12.87 15.07-2.54-2.51.03-.03A17.52 17.52 0 0 0 14.07 6H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7 1.62-4.33L19.12 17h-3.24z" />
        </svg>
        <span className="lang-code">{lang.code.toUpperCase()}</span>
      </button>
      {open && (
        <ul className="lang-list" role="listbox" aria-label={t("lang.label")} ref={list}>
          {menu.map(l => (
            <li
              key={l.code}
              data-code={l.code}
              role="option"
              tabIndex={-1}
              aria-selected={l.code === lang.code}
              onClick={() => pick(l.code)}
              onKeyDown={e => move(e, l.code)}
            >
              <b lang={l.tag} dir={l.rtl ? "rtl" : "ltr"}>{l.native}</b>
              {l.native !== l.english && <small lang="en" dir="ltr">{l.english}</small>}
              {l.code === lang.code && <span className="lang-check" aria-hidden="true">✓</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
