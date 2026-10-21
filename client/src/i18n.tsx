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
    navGaps: "פערי ידע",
    gapsTitle: "פערי ידע",
    gapsIntro: "שאלות שהמאגר לא ידע לענות עליהן, מהנשאלות ביותר. כל פער כאן מחכה למסמך שישלים אותו.",
    gapsEmpty: "אין כרגע פערים פתוחים. כשמישהו ישאל שאלה שאין עליה מידע - היא תופיע כאן.",
    askedTimes: (n: number) => (n === 1 ? "נשאל פעם אחת" : `נשאל ${n} פעמים`),
    lastAsked: "לאחרונה",
    examplesLabel: "איך שאלו:",
    notAGap: "לא פער",
    markedNotAGap: "סומן כ\"לא פער\" ויצא מהרשימה.",
    undo: "ביטול",
    reason_no_info: "אין מידע",
    reason_partial: "תשובה חלקית",
    reason_not_helpful: "לא עזר",
    notHelpful: "התשובה לא עזרה",
    notHelpfulThanks: "תודה, נרשם כפער לבדיקה",
    gapsLoadError: "לא הצלחנו לטעון את הפערים. נסו לרענן.",
    navAsk: "שאלות",
    navBrowse: "עיון במאגר",
    askPlaceholder: "שאלו כל שאלה על הנהלים, המוצר או תשובות ללקוחות...",
    followPlaceholder: "שאלת המשך...",
    send: "שליחה",
    newQuestion: "שאלה חדשה",
    you: "את/ה",
    assistant: "מרכז הידע",
    thinking: "מחפש בידע ומנסח תשובה...",
    sources: "מקורות",
    sourcesHint: "המסמכים שעליהם התשובה מבוססת",
    noSources: "לתשובה הזו אין מקורות מהמאגר.",
    openDoc: "פתיחת המסמך המלא",
    tryAsking: "אפשר לשאול למשל:",
    examples: ["מה עושים כשמתקבלת התראת דליפה?", "לקוח שואל למה המים נסגרו לו. מה עונים?", "כל כמה זמן צריך לעשות תחזוקה ליחידה?"],
    askIntro: "שאלו, וקבלו תשובה מלאה מתוך הנהלים והמסמכים שלנו - עם המקור בצד.",
    errNoKey: "החיבור ל-Claude עוד לא הוגדר. צריך להגדיר מפתח גישה בשרת.",
    errBadKey: "מפתח הגישה ל-Claude לא תקין. צריך לבדוק אותו בשרת.",
    errBusy: "יש עומס כרגע. נסו שוב בעוד דקה.",
    errExpired: "השיחה הזו הסתיימה. התחילו שאלה חדשה.",
    errTooLong: "השיחה הזו ארוכה מדי. התחילו שאלה חדשה.",
    errGeneric: "לא הצלחנו לקבל תשובה. נסו שוב.",
    declined: "לא ניתן לענות על השאלה הזו.",
    sourceN: (n: number) => `מקור ${n}`,
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
    navGaps: "Knowledge gaps",
    gapsTitle: "Knowledge gaps",
    gapsIntro: "Questions the knowledge base could not answer, most asked first. Each gap here is waiting for a document to fill it.",
    gapsEmpty: "No open gaps right now. When someone asks something the base has no information on, it will show up here.",
    askedTimes: (n: number) => (n === 1 ? "Asked once" : `Asked ${n} times`),
    lastAsked: "Last asked",
    examplesLabel: "How people asked:",
    notAGap: "Not a gap",
    markedNotAGap: "Marked as not a gap and removed from the list.",
    undo: "Undo",
    reason_no_info: "No info",
    reason_partial: "Partial answer",
    reason_not_helpful: "Didn't help",
    notHelpful: "This didn't help",
    notHelpfulThanks: "Thanks, logged as a gap to review",
    gapsLoadError: "Could not load the gaps. Please refresh.",
    navAsk: "Ask",
    navBrowse: "Browse",
    askPlaceholder: "Ask anything about procedures, the product or customer answers...",
    followPlaceholder: "Ask a follow-up...",
    send: "Send",
    newQuestion: "New question",
    you: "You",
    assistant: "Knowledge Center",
    thinking: "Searching the knowledge and writing an answer...",
    sources: "Sources",
    sourcesHint: "The documents this answer is based on",
    noSources: "This answer has no sources from the knowledge base.",
    openDoc: "Open the full document",
    tryAsking: "For example:",
    examples: ["What do we do when a leak alert comes in?", "A customer asks why their water was shut off. What do we answer?", "How often does a unit need maintenance?"],
    askIntro: "Ask, and get a complete answer from our procedures and documents - with the source on the side.",
    errNoKey: "The connection to Claude is not set up yet. An access key needs to be set on the server.",
    errBadKey: "The Claude access key is not valid. Please check it on the server.",
    errBusy: "The system is busy. Try again in a minute.",
    errExpired: "This conversation has ended. Start a new question.",
    errTooLong: "This conversation is too long. Start a new question.",
    errGeneric: "Could not get an answer. Try again.",
    declined: "This question cannot be answered.",
    sourceN: (n: number) => `Source ${n}`,
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
