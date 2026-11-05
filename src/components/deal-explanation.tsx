"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api/client";

/** Shows the stored explanation. Any failure leaves it in place. "Basic mode" is the unobtrusive notice. */
export function DealExplanation({ alertId, explanation, source }: { alertId: string; explanation: string; source: "llm" | "template" }) {
  const [text, setText] = useState(explanation);
  const [src, setSrc] = useState(source);

  useEffect(() => {
    if (source === "llm") return;
    let cancelled = false;
    api<{ explanation: string; source: "llm" | "template" }>(`/api/deals/${alertId}/explain`, { method: "POST" })
      .then((r) => {
        if (!cancelled) {
          setText(r.explanation);
          setSrc(r.source);
        }
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [alertId, source]);

  return (
    <div className="grid gap-1">
      <p className="text-sm leading-relaxed break-words">{text}</p>
      {src === "template" && <p className="text-xs text-muted-foreground">Basic mode: written from your rule check without AI.</p>}
    </div>
  );
}
