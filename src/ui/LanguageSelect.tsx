import { LANGS, setLang, useLang, type Lang } from "../i18n";

export function LanguageSelect() {
  const lang = useLang();
  return (
    <select className="lang-select" value={lang} onChange={(e) => setLang(e.target.value as Lang)} title="Language / Dil">
      {LANGS.map((l) => (
        <option key={l.id} value={l.id}>
          {l.label}
        </option>
      ))}
    </select>
  );
}
