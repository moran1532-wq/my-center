import { Link, NavLink, Route, Routes } from "react-router-dom";
import { useLang } from "./i18n";
import AskPage from "./pages/AskPage";
import KnowledgeList from "./pages/KnowledgeList";
import KnowledgeView from "./pages/KnowledgeView";

export default function App() {
  const { t, toggle } = useLang();
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="logo" aria-hidden>💧</span>
          <span>
            <strong>{t.appName}</strong>
            <small>{t.appTagline}</small>
          </span>
        </Link>
        <nav className="tabs">
          <NavLink to="/" end>{t.navAsk}</NavLink>
          <NavLink to="/browse">{t.navBrowse}</NavLink>
        </nav>
        <button className="lang-btn" onClick={toggle}>{t.switchTo}</button>
      </header>
      <main className="content">
        <Routes>
          <Route path="/" element={<AskPage />} />
          <Route path="/browse" element={<KnowledgeList />} />
          <Route path="/item/:id" element={<KnowledgeView />} />
        </Routes>
      </main>
    </div>
  );
}
