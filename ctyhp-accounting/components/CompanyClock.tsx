"use client";
import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { DEFAULT_TIME_ZONE } from "@/lib/domain/default-time-zone";
import { todayInTimeZone } from "@/lib/format";

/**
 * The company's clock, for client screens: its time zone and its today.
 *
 * A screen that took today from the reader's browser and a report that took it
 * from UTC could name different days for the same moment: one said "as of"
 * the 16th, the next the 17th. Every screen now reads the day the company's
 * own people are living in, which is the day its books are kept in.
 *
 * Today arrives from the server so the first render matches it exactly, then
 * is checked once more in the browser in case the page has stayed open past
 * midnight.
 */
interface CompanyClockValue {
  /** The company's time zone, `America/New_York`. */
  timeZone: string;
  /** The company's today, `2026-10-16`. */
  today: string;
}

const CompanyClockContext = createContext<CompanyClockValue | null>(null);

export function CompanyClockProvider({
  timeZone,
  today,
  children,
}: CompanyClockValue & { children: ReactNode }) {
  const [current, setCurrent] = useState(today);
  useEffect(() => {
    const refresh = () => setCurrent(todayInTimeZone(timeZone));
    refresh();
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [timeZone]);
  return (
    <CompanyClockContext.Provider value={{ timeZone, today: current }}>{children}</CompanyClockContext.Provider>
  );
}

/**
 * The company's time zone and today. Outside a company (sign-in, status) it
 * falls back to the default zone, the same one a new company starts with.
 */
export function useCompanyClock(): CompanyClockValue {
  const value = useContext(CompanyClockContext);
  return value ?? { timeZone: DEFAULT_TIME_ZONE, today: todayInTimeZone(DEFAULT_TIME_ZONE) };
}
