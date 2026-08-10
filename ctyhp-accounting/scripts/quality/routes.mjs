import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export function discoverStaticRoutes(appDir, prefix = "") {
  const routes = [];
  for (const entry of readdirSync(appDir)) {
    const full = join(appDir, entry);
    if (statSync(full).isDirectory()) {
      if (!entry.startsWith("[")) routes.push(...discoverStaticRoutes(full, `${prefix}/${entry}`));
    } else if (entry === "page.tsx" && prefix) {
      routes.push(prefix);
    }
  }
  return [...new Set(routes)].sort();
}
