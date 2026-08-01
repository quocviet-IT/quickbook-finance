import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scriptRoot = join(projectRoot, "scripts");

function scriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return scriptFiles(path);
    return [".js", ".mjs", ".cjs"].includes(extname(entry.name)) ? [path] : [];
  });
}

const literalObjectPassword =
  /\b(?:password|passwd|pwd)\s*:\s*["'`](?!["'`])[^\r\n"'`]+["'`]/i;
const literalAssignedPassword =
  /\b(?:[A-Z0-9_]*PASSWORD|password)\s*=\s*["'`](?!["'`])[^\r\n"'`]+["'`]/;
const fallbackPassword =
  /\b(?:[A-Z0-9_]*PASSWORD|password)\s*=\s*[^;\r\n]*\?\?\s*["'`](?!["'`])[^\r\n"'`]+["'`]/;

const requestedFiles = process.argv.slice(2);
const files = requestedFiles.length
  ? requestedFiles.map((file) => resolve(file))
  : [
      ...scriptFiles(scriptRoot),
      join(projectRoot, "tests", "e2e", "support", "session.ts"),
    ];

const offenders = files.filter((file) => {
  const source = readFileSync(file, "utf8");
  return (
    literalObjectPassword.test(source) ||
    literalAssignedPassword.test(source) ||
    fallbackPassword.test(source)
  );
});

if (offenders.length) {
  const paths = offenders.map((file) => {
    const local = relative(projectRoot, file);
    return local.startsWith("..") ? file : local;
  });
  console.error(`Literal password values found in:\n${paths.join("\n")}`);
  process.exitCode = 1;
}
