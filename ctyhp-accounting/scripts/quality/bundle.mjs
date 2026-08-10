import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const MANIFEST_NAME = "page_client-reference-manifest.js";
const MANIFEST_ASSIGNMENT = /globalThis\.__RSC_MANIFEST\[(["'])(.*?)\1\]\s*=\s*(\{.*\});?\s*$/s;

function manifestAssignment(text) {
  const match = text.match(MANIFEST_ASSIGNMENT);
  if (!match) throw new Error("Unreadable client reference manifest");
  return match;
}

function filesNamed(directory, name) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    throw new Error(`Unreadable Turbopack manifest directory ${directory}: ${error.message}`);
  }

  return entries.flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return filesNamed(path, name);
    return entry.isFile() && entry.name === name ? [path] : [];
  });
}

function routeKeyFromManifest(text) {
  const match = manifestAssignment(text);
  return match[2];
}

function routeFromManifestKey(key) {
  const segments = key.replace(/^\/+/, "").split("/").filter(Boolean);
  if (segments.at(-1) === "page") segments.pop();
  const visible = segments.filter((segment) => !/^\([^/]+\)$/.test(segment));
  return visible.length ? `/${visible.join("/")}` : "/";
}

function normalizeChunk(nextDir, chunk) {
  if (typeof chunk !== "string" || !chunk.length) {
    throw new Error("Incomplete client reference manifest: entryJSFiles must contain chunk paths");
  }
  const normalized = chunk.replace(/^\/?_next\//, "").replaceAll("\\", "/");
  if (!normalized.startsWith("static/chunks/") || normalized.includes("../")) {
    throw new Error(`Incomplete client reference manifest: invalid browser chunk ${chunk}`);
  }
  const path = resolve(nextDir, normalized);
  const root = resolve(nextDir);
  if (relative(root, path).startsWith("..")) {
    throw new Error(`Incomplete client reference manifest: invalid browser chunk ${chunk}`);
  }
  return { chunk: normalized, path };
}

export function parseClientReferenceManifest(text) {
  if (typeof text !== "string") throw new Error("Unreadable client reference manifest");
  const match = manifestAssignment(text);
  try {
    return JSON.parse(match[3]);
  } catch (error) {
    throw new Error(`Unreadable client reference manifest: ${error.message}`);
  }
}

export function summarizeRouteChunks(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)
    || !manifest.entryJSFiles || typeof manifest.entryJSFiles !== "object" || Array.isArray(manifest.entryJSFiles)) {
    throw new Error("Incomplete client reference manifest: entryJSFiles is missing");
  }
  const entries = Object.values(manifest.entryJSFiles);
  if (!entries.length || entries.some((chunks) => !Array.isArray(chunks))) {
    throw new Error("Incomplete client reference manifest: entryJSFiles is missing or invalid");
  }
  const chunks = entries.flat();
  if (!chunks.length || chunks.some((chunk) => typeof chunk !== "string" || !chunk.length)) {
    throw new Error("Incomplete client reference manifest: entryJSFiles contains no JavaScript chunks");
  }
  return [...new Set(chunks)].sort();
}

export function chunkSize(nextDir, chunk) {
  const { chunk: normalized, path } = normalizeChunk(nextDir, chunk);
  let stat;
  let contents;
  try {
    stat = statSync(path);
    if (!stat.isFile()) throw new Error("not a file");
    contents = readFileSync(path);
  } catch (error) {
    throw new Error(`Unreadable referenced chunk ${normalized}: ${error.message}`);
  }
  return {
    chunk: normalized,
    bytes: stat.size,
    gzipBytes: gzipSync(contents).byteLength,
    hash: createHash("sha256").update(contents).digest("hex"),
  };
}

export function analyzeBundle(nextDir) {
  const root = resolve(nextDir);
  const manifestPaths = filesNamed(join(root, "server", "app"), MANIFEST_NAME).sort();
  if (!manifestPaths.length) {
    throw new Error(`No Turbopack client reference manifests found under ${join(root, "server", "app")}`);
  }

  const routeChunks = new Map();
  for (const manifestPath of manifestPaths) {
    let text;
    try {
      text = readFileSync(manifestPath, "utf8");
    } catch (error) {
      throw new Error(`Unreadable client reference manifest ${manifestPath}: ${error.message}`);
    }
    const route = routeFromManifestKey(routeKeyFromManifest(text));
    const chunks = summarizeRouteChunks(parseClientReferenceManifest(text));
    const current = routeChunks.get(route) ?? new Set();
    chunks.forEach((chunk) => current.add(chunk));
    routeChunks.set(route, current);
  }

  const chunkUsage = new Map();
  for (const [route, chunks] of routeChunks) {
    for (const chunk of chunks) {
      const usage = chunkUsage.get(chunk) ?? new Set();
      usage.add(route);
      chunkUsage.set(chunk, usage);
    }
  }
  if (!chunkUsage.size) throw new Error("No browser JavaScript chunks were referenced by Turbopack manifests");

  const chunkDetails = new Map([...chunkUsage.keys()].sort().map((chunk) => [chunk, chunkSize(root, chunk)]));
  const chunks = [...chunkDetails.values()].map((detail) => ({
    ...detail,
    routes: [...chunkUsage.get(detail.chunk)].sort(),
  }));
  const routes = [...routeChunks.entries()].map(([route, routeChunkSet]) => {
    const routeChunkNames = [...routeChunkSet].sort();
    const details = routeChunkNames.map((chunk) => chunkDetails.get(chunk));
    return {
      route,
      chunks: routeChunkNames,
      bytes: details.reduce((total, detail) => total + detail.bytes, 0),
      gzipBytes: details.reduce((total, detail) => total + detail.gzipBytes, 0),
    };
  }).sort((left, right) => left.route.localeCompare(right.route));
  const sharedChunks = chunks.filter((chunk) => chunk.routes.length > 1);

  return {
    version: 1,
    routes,
    chunks,
    total: {
      bytes: chunks.reduce((total, chunk) => total + chunk.bytes, 0),
      gzipBytes: chunks.reduce((total, chunk) => total + chunk.gzipBytes, 0),
    },
    shared: {
      chunks: sharedChunks.map((chunk) => chunk.chunk),
      bytes: sharedChunks.reduce((total, chunk) => total + chunk.bytes, 0),
      gzipBytes: sharedChunks.reduce((total, chunk) => total + chunk.gzipBytes, 0),
    },
  };
}
