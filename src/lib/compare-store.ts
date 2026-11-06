"use client";

import { useSyncExternalStore } from "react";

/** The products picked for comparing. A browser convenience: losing it loses nothing. */
const KEY = "pricedrop:compare";
export const COMPARE_MAX = 4;
const listeners = new Set<() => void>();
const EMPTY: string[] = [];
let cache: string[] = EMPTY;
let loaded = false;

function read(): string[] {
  if (loaded) return cache;
  loaded = true;
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (Array.isArray(parsed)) cache = parsed.filter((x): x is string => typeof x === "string").slice(0, COMPARE_MAX);
  } catch {
    cache = EMPTY;
  }
  return cache;
}

function write(next: string[]) {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage may be blocked. The list still works for this page view.
  }
  listeners.forEach((l) => l());
}

export function toggleCompare(key: string) {
  const cur = read();
  if (cur.includes(key)) write(cur.filter((k) => k !== key));
  else if (cur.length < COMPARE_MAX) write([...cur, key]);
}
export const clearCompare = () => write([]);

export const CHAT_STORE = "pricedrop:chat";

/** This browser's picks and conversation belong to one person, so they end with that person's session. */
export function forgetShoppingSession() {
  clearCompare();
  try {
    sessionStorage.removeItem(CHAT_STORE);
  } catch {
    // Storage may be blocked, in which case nothing was kept.
  }
}
/** The current picks, for reading at the moment of an action rather than on every render. */
export const currentCompare = () => read();

export function useCompare(): string[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    read,
    () => EMPTY,
  );
}
