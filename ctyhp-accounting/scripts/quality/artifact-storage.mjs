import { randomBytes } from "node:crypto";
import {
  closeSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

function containedOrEqual(root, target) {
  const fromRoot = relative(root, target);
  return fromRoot === ""
    || (fromRoot !== ".."
      && !fromRoot.startsWith(`..\\`)
      && !fromRoot.startsWith("../")
      && !isAbsolute(fromRoot));
}

function entryAt(path) {
  return lstatSync(path, { throwIfNoEntry: false });
}

function rejectUnsafeEntry(path, entry, label, expected) {
  const matches = expected === "directory" ? entry?.isDirectory() : entry?.isFile();
  if (!entry || entry.isSymbolicLink() || !matches) {
    throw new Error(`Owned quality ${label} must be a real ${expected}, not a link, reparse point, or non-${expected}`);
  }
}

export function ensureOwnedDirectory(rootDir) {
  const lexicalRoot = resolve(rootDir);
  try {
    mkdirSync(lexicalRoot, { recursive: true });
  } catch (error) {
    throw new Error(`Owned quality result root could not be created at ${lexicalRoot}: ${error.message}`);
  }
  rejectUnsafeEntry(lexicalRoot, entryAt(lexicalRoot), "result root", "directory");

  const lexicalParent = dirname(lexicalRoot);
  const physicalParent = realpathSync(lexicalParent);
  const physicalRoot = realpathSync(lexicalRoot);
  if (!containedOrEqual(physicalParent, physicalRoot) || physicalParent === physicalRoot) {
    throw new Error("Owned quality result root must remain physically contained by its real parent");
  }
  return { lexicalRoot, physicalRoot };
}

function validateDestinationParent(root, destination) {
  const lexicalParent = dirname(destination);
  if (!containedOrEqual(root.lexicalRoot, lexicalParent)) {
    throw new Error("Owned quality artifact parent escapes the intended result root");
  }
  mkdirSync(lexicalParent, { recursive: true });

  const fromRoot = relative(root.lexicalRoot, lexicalParent);
  let current = root.lexicalRoot;
  for (const part of fromRoot.split(/[\\/]+/).filter(Boolean)) {
    current = join(current, part);
    rejectUnsafeEntry(current, entryAt(current), "artifact parent", "directory");
  }

  const physicalParent = realpathSync(lexicalParent);
  if (!containedOrEqual(root.physicalRoot, physicalParent)) {
    throw new Error("Owned quality artifact parent escapes physical result-root containment");
  }
  return { lexicalParent, physicalParent };
}

function validateFinalEntry(path) {
  const entry = entryAt(path);
  if (entry) rejectUnsafeEntry(path, entry, "artifact target", "file");
}

function defaultTemporaryPath(destination) {
  return join(
    dirname(destination),
    `.${basename(destination)}.${process.pid}.${randomBytes(16).toString("hex")}.tmp`,
  );
}

function fileIdentity(entry) {
  return `${entry.dev}:${entry.ino}:${entry.birthtimeMs}`;
}

function cleanupCreatedTemporary(path, identity) {
  try {
    const entry = entryAt(path);
    if (entry?.isFile() && !entry.isSymbolicLink() && fileIdentity(entry) === identity) unlinkSync(path);
  } catch {
    // Preserve any entry that is not provably the exact temporary file created by this call.
  }
}

export function atomicWriteOwnedFile(rootDir, destinationPath, contents, options = {}) {
  const root = ensureOwnedDirectory(rootDir);
  const destination = resolve(destinationPath);
  const parent = validateDestinationParent(root, destination);
  validateFinalEntry(destination);

  const temporary = resolve(
    options.temporaryPathFor?.(destination) ?? defaultTemporaryPath(destination),
  );
  if (dirname(temporary) !== parent.lexicalParent) {
    throw new Error("Owned quality temporary artifact must be in the same directory as its target");
  }
  const temporaryEntry = entryAt(temporary);
  if (temporaryEntry) {
    throw new Error("Owned quality temporary artifact must not already exist or be a link or reparse point");
  }

  let descriptor;
  let createdIdentity;
  let renamed = false;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    createdIdentity = fileIdentity(fstatSync(descriptor));
    writeFileSync(descriptor, contents, "utf8");
    closeSync(descriptor);
    descriptor = undefined;

    validateFinalEntry(destination);
    const physicalTemporary = realpathSync(temporary);
    if (!containedOrEqual(parent.physicalParent, physicalTemporary)) {
      throw new Error("Owned quality temporary artifact escapes physical result-root containment");
    }
    renameSync(temporary, destination);
    renamed = true;
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // Cleanup below is still restricted to the created file identity.
      }
    }
    if (!renamed && createdIdentity) cleanupCreatedTemporary(temporary, createdIdentity);
  }
}
