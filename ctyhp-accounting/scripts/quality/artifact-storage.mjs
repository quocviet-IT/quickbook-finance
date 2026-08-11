import { randomBytes } from "node:crypto";
import {
  closeSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

const DEFAULT_FS = Object.freeze({
  closeSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
});

function filesystem(overrides) {
  return overrides ? { ...DEFAULT_FS, ...overrides } : DEFAULT_FS;
}

function containedOrEqual(root, target) {
  const fromRoot = relative(root, target);
  return fromRoot === ""
    || (fromRoot !== ".."
      && !fromRoot.startsWith(`..\\`)
      && !fromRoot.startsWith("../")
      && !isAbsolute(fromRoot));
}

function entryAt(path, fs) {
  return fs.lstatSync(path, { throwIfNoEntry: false });
}

function rejectUnsafeEntry(path, entry, label, expected) {
  const matches = expected === "directory" ? entry?.isDirectory() : entry?.isFile();
  if (!entry || entry.isSymbolicLink() || !matches) {
    throw new Error(`Owned quality ${label} must be a real ${expected}, not a link, reparse point, or non-${expected}`);
  }
}

function validateExistingAncestors(path, fs) {
  const ancestors = [];
  for (let current = path; ; current = dirname(current)) {
    ancestors.push(current);
    if (dirname(current) === current) break;
  }
  for (const ancestor of ancestors.reverse()) {
    const entry = entryAt(ancestor, fs);
    if (!entry) continue;
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new Error("Owned quality result-root ancestor must be a real directory, not a link or reparse point");
    }
  }
}

function ownedDirectoryWithFs(rootDir, fs, create) {
  const lexicalRoot = resolve(rootDir);
  validateExistingAncestors(lexicalRoot, fs);
  if (create) {
    try {
      fs.mkdirSync(lexicalRoot, { recursive: true });
    } catch (error) {
      throw new Error(`Owned quality result root could not be created at ${lexicalRoot}: ${error.message}`);
    }
  }
  validateExistingAncestors(lexicalRoot, fs);
  rejectUnsafeEntry(lexicalRoot, entryAt(lexicalRoot, fs), "result root", "directory");

  const lexicalParent = dirname(lexicalRoot);
  const physicalParent = fs.realpathSync(lexicalParent);
  const physicalRoot = fs.realpathSync(lexicalRoot);
  if (!containedOrEqual(physicalParent, physicalRoot) || physicalParent === physicalRoot) {
    throw new Error("Owned quality result root must remain physically contained by its real parent");
  }
  return { lexicalRoot, physicalRoot };
}

export function ensureOwnedDirectory(rootDir, options = {}) {
  return ownedDirectoryWithFs(rootDir, filesystem(options.fs), true);
}

function validateDestinationParent(root, destination, fs, create) {
  const lexicalParent = dirname(destination);
  if (!containedOrEqual(root.lexicalRoot, lexicalParent)) {
    throw new Error("Owned quality artifact parent escapes the intended result root");
  }

  const fromRoot = relative(root.lexicalRoot, lexicalParent);
  const parts = fromRoot.split(/[\\/]+/).filter(Boolean);
  let current = root.lexicalRoot;
  for (const part of parts) {
    current = join(current, part);
    const entry = entryAt(current, fs);
    if (!entry && create) {
      // Node has no fd-relative mkdir. Creating exactly one validated segment
      // at a time avoids traversing a prepositioned linked descendant, while
      // the checks below fail closed on filesystem changes Node can observe.
      fs.mkdirSync(current);
    }
    rejectUnsafeEntry(current, entryAt(current, fs), "artifact parent", "directory");
  }

  current = root.lexicalRoot;
  for (const part of parts) {
    current = join(current, part);
    rejectUnsafeEntry(current, entryAt(current, fs), "artifact parent", "directory");
  }

  const physicalParent = fs.realpathSync(lexicalParent);
  if (!containedOrEqual(root.physicalRoot, physicalParent)) {
    throw new Error("Owned quality artifact parent escapes physical result-root containment");
  }
  return { lexicalParent, physicalParent };
}

function validateFinalEntry(path, fs) {
  const entry = entryAt(path, fs);
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

function cleanupOwnedPath(path, identity, fs) {
  try {
    const entry = entryAt(path, fs);
    if (entry?.isFile() && !entry.isSymbolicLink() && fileIdentity(entry) === identity) fs.unlinkSync(path);
  } catch {
    // Preserve any entry that is not provably the exact temporary file created by this call.
  }
}

export function atomicWriteOwnedFile(rootDir, destinationPath, contents, options = {}) {
  const fs = filesystem(options.fs);
  const root = ownedDirectoryWithFs(rootDir, fs, true);
  const destination = resolve(destinationPath);
  const parent = validateDestinationParent(root, destination, fs, true);
  validateFinalEntry(destination, fs);

  const temporary = resolve(
    options.temporaryPathFor?.(destination) ?? defaultTemporaryPath(destination),
  );
  if (dirname(temporary) !== parent.lexicalParent) {
    throw new Error("Owned quality temporary artifact must be in the same directory as its target");
  }
  const temporaryEntry = entryAt(temporary, fs);
  if (temporaryEntry) {
    throw new Error("Owned quality temporary artifact must not already exist or be a link or reparse point");
  }

  let descriptor;
  let createdIdentity;
  let renamed = false;
  let published = false;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    createdIdentity = fileIdentity(fs.fstatSync(descriptor));
    fs.writeFileSync(descriptor, contents, "utf8");

    const temporaryBeforePublish = entryAt(temporary, fs);
    if (!temporaryBeforePublish?.isFile() || temporaryBeforePublish.isSymbolicLink()
      || fileIdentity(temporaryBeforePublish) !== createdIdentity) {
      throw new Error("Owned quality temporary artifact identity changed before publish");
    }
    validateFinalEntry(destination, fs);
    const physicalTemporary = fs.realpathSync(temporary);
    if (!containedOrEqual(parent.physicalParent, physicalTemporary)) {
      throw new Error("Owned quality temporary artifact escapes physical result-root containment");
    }
    // Node exposes no fd-relative rename. Keeping the fd open and checking the
    // pathname identity immediately before and after rename narrows, but cannot
    // eliminate, same-user races between those filesystem operations.
    fs.renameSync(temporary, destination);
    renamed = true;

    const descriptorAfterPublish = fs.fstatSync(descriptor);
    const destinationAfterPublish = entryAt(destination, fs);
    if (!destinationAfterPublish?.isFile() || destinationAfterPublish.isSymbolicLink()
      || fileIdentity(descriptorAfterPublish) !== createdIdentity
      || fileIdentity(destinationAfterPublish) !== createdIdentity) {
      throw new Error("Owned quality artifact identity changed during publish");
    }
    const physicalDestination = fs.realpathSync(destination);
    if (!containedOrEqual(parent.physicalParent, physicalDestination)) {
      throw new Error("Owned quality artifact escaped physical result-root containment during publish");
    }
    published = true;
  } finally {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // Cleanup below is still restricted to the created file identity.
      }
    }
    if (!renamed && createdIdentity) cleanupOwnedPath(temporary, createdIdentity, fs);
    if (renamed && !published && createdIdentity) cleanupOwnedPath(destination, createdIdentity, fs);
  }
}

export function readOwnedFile(rootDir, sourcePath, options = {}) {
  const fs = filesystem(options.fs);
  const root = ownedDirectoryWithFs(rootDir, fs, false);
  const source = resolve(sourcePath);
  const parent = validateDestinationParent(root, source, fs, false);
  validateFinalEntry(source, fs);
  const physicalSource = fs.realpathSync(source);
  if (!containedOrEqual(parent.physicalParent, physicalSource)) {
    throw new Error("Owned quality artifact source escapes physical result-root containment");
  }

  let descriptor;
  try {
    descriptor = fs.openSync(source, "r");
    const openedIdentity = fileIdentity(fs.fstatSync(descriptor));
    const sourceBeforeRead = entryAt(source, fs);
    if (!sourceBeforeRead?.isFile() || sourceBeforeRead.isSymbolicLink()
      || fileIdentity(sourceBeforeRead) !== openedIdentity) {
      throw new Error("Owned quality artifact source identity changed before read");
    }
    const contents = fs.readFileSync(descriptor, "utf8");
    const sourceAfterRead = entryAt(source, fs);
    if (!sourceAfterRead?.isFile() || sourceAfterRead.isSymbolicLink()
      || fileIdentity(fs.fstatSync(descriptor)) !== openedIdentity
      || fileIdentity(sourceAfterRead) !== openedIdentity) {
      throw new Error("Owned quality artifact source identity changed during read");
    }
    return contents;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}
