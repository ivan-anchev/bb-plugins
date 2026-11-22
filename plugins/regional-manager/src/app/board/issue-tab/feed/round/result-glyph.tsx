// A criterion's result as a glyph: a check, a cross, or a warning sign. Shape tells them apart, not
// colour alone; the words beside it or its cell's name say which.
import type { CriterionResult } from "../../../../../model/verdict/verdict.ts";

export function ResultGlyph({ result }: { result: CriterionResult }) {
  return (
    <svg className="rmi-result-glyph" data-result={result} width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {result === "pass" && <path d="M20 6 9 17l-5-5" />}
      {result === "fail" && <path d="M18 6 6 18M6 6l12 12" />}
      {result === "unverifiable" && <path d="M12 8v4M12 16h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />}
    </svg>
  );
}
