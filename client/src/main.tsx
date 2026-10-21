import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, HashRouter } from "react-router-dom";
import { LangProvider } from "./i18n";
import App from "./App";
import "./index.css";

const Router = import.meta.env.VITE_DEMO === "1" ? HashRouter : BrowserRouter;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LangProvider>
      <Router>
        <App />
      </Router>
    </LangProvider>
  </StrictMode>,
);
