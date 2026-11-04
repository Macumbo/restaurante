"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { pt, type Dict } from "./pt";
import { en } from "./en";
import type { I18nText } from "@/lib/types";

/** Idiomas ativos. Para acrescentar um idioma: criar o dicionário e registá-lo aqui. */
export const LANGUAGES = { pt: { label: "Português", dict: pt }, en: { label: "English", dict: en } } as const;
export type Lang = keyof typeof LANGUAGES;
export const DEFAULT_LANG: Lang = "pt";

type Ctx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: keyof Dict, vars?: Record<string, string | number>) => string;
  /** Escolhe a tradução de um texto do menu, com recurso ao português. */
  tx: (text: I18nText | null | undefined) => string;
};

const I18nContext = createContext<Ctx | null>(null);

function detect(): Lang {
  try {
    const saved = localStorage.getItem("lang");
    if (saved && saved in LANGUAGES) return saved as Lang;
  } catch {}
  const nav = typeof navigator !== "undefined" ? navigator.language.slice(0, 2) : DEFAULT_LANG;
  return (nav in LANGUAGES ? nav : DEFAULT_LANG) as Lang;
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(DEFAULT_LANG);

  useEffect(() => setLangState(detect()), []);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem("lang", l);
    } catch {}
  }, []);

  const value = useMemo<Ctx>(() => {
    const dict = LANGUAGES[lang].dict;
    return {
      lang,
      setLang,
      t: (key, vars) => {
        let s = dict[key] ?? pt[key] ?? String(key);
        if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
        return s;
      },
      tx: (text) => {
        if (!text) return "";
        return text[lang] || text[DEFAULT_LANG] || Object.values(text)[0] || "";
      },
    };
  }, [lang, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n fora do I18nProvider");
  return ctx;
}
