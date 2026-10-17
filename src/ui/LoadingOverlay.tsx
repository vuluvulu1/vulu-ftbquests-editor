import { t } from "../i18n";
export type StepState = "pending" | "active" | "done" | "skipped";

export interface LoadStep {
  id: "book" | "index" | "texts" | "icons";
  label: string;
  state: StepState;
  /** "12/650" style progress or a short result. */
  detail?: string;
}

export function initialSteps(withAssets: boolean): LoadStep[] {
  const skipped = withAssets ? "pending" : "skipped";
  return [
    { id: "book", label: "Reading the quest book", state: "active" },
    { id: "index", label: "Scanning mod files", state: skipped },
    { id: "texts", label: "Loading translations", state: skipped },
    { id: "icons", label: "Preparing icons", state: skipped },
  ];
}

const MARK: Record<StepState, string> = { pending: "•", active: "", done: "✓", skipped: "–" };

function fraction(detail: string | undefined): number | undefined {
  const m = /^(\d+)\/(\d+)$/.exec(detail ?? "");
  return m && Number(m[2]) > 0 ? Number(m[1]) / Number(m[2]) : undefined;
}

export function LoadingOverlay({ steps, source, onSkip }: { steps: LoadStep[]; source: string; onSkip?: () => void }) {
  return (
    <div className="loading-overlay">
      <div className="loading-card">
        <h2>{t("Loading modpack")}</h2>
        <div className="mono dim loading-source" title={source}>
          {source}
        </div>
        <ul className="loading-steps">
          {steps.map((s) => {
            const f = s.state === "active" ? fraction(s.detail) : undefined;
            return (
              <li key={s.id} className={s.state}>
                <span className="step-mark">{s.state === "active" ? <span className="spinner" /> : MARK[s.state]}</span>
                <span className="step-label">{t(s.label)}</span>
                <span className="step-detail">{s.detail}</span>
                {f !== undefined && (
                  <span className="step-bar">
                    <span style={{ width: `${Math.round(f * 100)}%` }} />
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        {onSkip && (
          <button className="secondary" onClick={onSkip}>
            {t("Continue without waiting")}
          </button>
        )}
      </div>
    </div>
  );
}
