import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, HashRouter } from "react-router-dom";
import { LangProvider } from "./i18n";
import App from "./App";
import ErrorBoundary from "./ErrorBoundary";
import "./index.css";

const Router = import.meta.env.VITE_DEMO === "1" ? HashRouter : BrowserRouter;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LangProvider>
      <Router>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </Router>
    </LangProvider>
  </StrictMode>,
);

// Errors outside React (e.g. in a promise) - show them instead of failing silently.
window.addEventListener("unhandledrejection", (e) => console.error("unhandled:", e.reason));
