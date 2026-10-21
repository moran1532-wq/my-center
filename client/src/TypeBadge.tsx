import type { KnowledgeType } from "./api";
import { useLang } from "./i18n";

export default function TypeBadge({ type }: { type: KnowledgeType }) {
  const { t } = useLang();
  return <span className={`badge badge-${type}`}>{t[type]}</span>;
}
