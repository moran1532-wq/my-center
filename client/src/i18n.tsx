import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Lang } from "./api";

export type { Lang };

const dict = {
  he: {
    appName: "מרכז ידע",
    appTagline: "נהלים, מסמכים ותשובות ללקוחות - במקום אחד",
    switchTo: "English",
    all: "הכל",
    procedure: "נוהל",
    document: "מסמך",
    customer_answer: "תשובה ללקוח",
    procedures: "נהלים",
    documents: "מסמכים",
    customer_answers: "תשובות ללקוחות",
    search: "חיפוש לפי מילה...",
    sample: "לדוגמה בלבד",
    topic: "נושא",
    updated: "עודכן",
    owner: "אחראי",
    back: "חזרה לרשימה",
    loading: "טוען...",
    noResults: "לא נמצאו פריטים",
    error: "לא הצלחנו לטעון את הנתונים. נסו לרענן.",
    notFound: "הפריט לא נמצא",
    count: (n: number) => `${n} פריטים`,
  },
  en: {
    appName: "Knowledge Center",
    appTagline: "Procedures, documents and customer answers - in one place",
    switchTo: "עברית",
    all: "All",
    procedure: "Procedure",
    document: "Document",
    customer_answer: "Customer answer",
    procedures: "Procedures",
    documents: "Documents",
    customer_answers: "Customer answers",
    search: "Search by word...",
    sample: "Sample only",
    topic: "Topic",
    updated: "Updated",
    owner: "Owner",
    back: "Back to list",
    loading: "Loading...",
    noResults: "No items found",
    error: "Could not load data. Please refresh.",
    notFound: "Item not found",
    count: (n: number) => `${n} items`,
  },
};

export type Dict = (typeof dict)["he"];

const Ctx = createContext<{ lang: Lang; t: Dict; toggle: () => void }>(null!);

function readLang(): Lang {
  try {
    return localStorage.getItem("lang") === "en" ? "en" : "he";
  } catch {
    return "he";
  }
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(readLang);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "he" ? "rtl" : "ltr";
    document.title = dict[lang].appName;
    try {
      localStorage.setItem("lang", lang);
    } catch {
      /* storage unavailable - fine */
    }
  }, [lang]);
  return (
    <Ctx.Provider value={{ lang, t: dict[lang], toggle: () => setLang(lang === "he" ? "en" : "he") }}>
      {children}
    </Ctx.Provider>
  );
}

export const useLang = () => useContext(Ctx);
