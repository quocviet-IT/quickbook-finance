const FAVORITES_KEY = "ctyhp.report-center.favorites";
const RECENT_KEY = "ctyhp.report-center.recent";
const MAX_RECENT_REPORTS = 5;

function readList(key: string): string[] {
  if (typeof window === "undefined") return [];

  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function writeList(key: string, values: string[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(values));
}

export function getFavoriteReportIds() {
  return readList(FAVORITES_KEY);
}

export function getRecentReportIds() {
  return readList(RECENT_KEY);
}

export function toggleFavoriteReport(reportId: string) {
  const current = getFavoriteReportIds();
  const next = current.includes(reportId)
    ? current.filter((id) => id !== reportId)
    : [...current, reportId];
  writeList(FAVORITES_KEY, next);
  return next;
}

export function recordRecentReport(reportId: string) {
  const next = [
    reportId,
    ...getRecentReportIds().filter((id) => id !== reportId),
  ].slice(0, MAX_RECENT_REPORTS);
  writeList(RECENT_KEY, next);
  return next;
}
