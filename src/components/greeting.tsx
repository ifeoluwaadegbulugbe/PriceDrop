"use client";

import { useSyncExternalStore } from "react";

const noSubscribe = () => () => undefined;

function greetingNow() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning." : h < 18 ? "Good afternoon." : "Good evening.";
}

/** Uses the shopper's own clock, so it's only worked out in the browser. */
export function Greeting() {
  const greeting = useSyncExternalStore(noSubscribe, greetingNow, () => "Hello.");
  return <p className="text-sm font-medium text-accent-foreground">{greeting} What would you love to find today?</p>;
}
