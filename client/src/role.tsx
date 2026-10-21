import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { AskError, getRole, type Role } from "./api";
import { useLang } from "./i18n";

const Ctx = createContext<Role>("member");
export const useIsOwner = () => useContext(Ctx) === "owner";

/** Loads who is signed in. Until known - or if not signed in - only member actions show. */
export function RoleProvider({ children }: { children: ReactNode }) {
  const { t } = useLang();
  const [role, setRole] = useState<Role>("member");
  const [error, setError] = useState("");
  useEffect(() => {
    getRole().then(setRole).catch((e) => setError(e instanceof AskError && e.code === "auth_not_configured" ? t.authNotConfigured : t.notSignedIn));
  }, []);
  return (
    <Ctx.Provider value={role}>
      {error && <p className="auth-banner" role="alert">{error}</p>}
      {children}
    </Ctx.Provider>
  );
}
