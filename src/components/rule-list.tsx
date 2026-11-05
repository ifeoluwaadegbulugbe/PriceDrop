import { CircleCheck, CircleHelp, CircleX } from "lucide-react";
import { CHECK_LABELS, UNKNOWN_LABELS } from "@/lib/ai/explain";
import type { Evaluation } from "@/lib/evaluation/evaluate";

export function RuleList({ evaluation }: { evaluation: Evaluation }) {
  return (
    <ul className="grid gap-2 text-sm">
      {evaluation.failed.map((c) => (
        <li key={`f-${c}`} className="flex items-start gap-2">
          <CircleX aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
          <span><span className="sr-only">Failed: </span>{CHECK_LABELS[c]}</span>
        </li>
      ))}
      {evaluation.unknown.map((c) => (
        <li key={`u-${c}`} className="flex items-start gap-2">
          <CircleHelp aria-hidden className="mt-0.5 size-4 shrink-0 text-caution" />
          <span><span className="sr-only">Unknown: </span>{UNKNOWN_LABELS[c]}</span>
        </li>
      ))}
      {evaluation.passed.map((c) => (
        <li key={`p-${c}`} className="flex items-start gap-2">
          <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-deal" />
          <span><span className="sr-only">Passed: </span>{CHECK_LABELS[c]}</span>
        </li>
      ))}
    </ul>
  );
}
