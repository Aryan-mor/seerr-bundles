// Shrinks the flat node_modules of the Seerr bundle. A flat install repeats a package under every
// package that wanted a slightly different peer set: here 40 copies of react-aria, 1 GB. Nothing
// here changes what runs, only what is stored.
//
//   node seerr-bundle-prune.mjs <staged app folder>
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const app = process.argv[2];
if (!app) {
  console.error("usage: seerr-bundle-prune.mjs <staged app folder>");
  process.exit(1);
}
const root = path.join(app, "node_modules");

function version(dir) {
  try {
    const p = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    return `${p.name}@${p.version}`;
  } catch {
    return null;
  }
}

let removedCopies = 0;
let removedFiles = 0;
let removedBytes = 0;

function size(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

function packagesIn(modules) {
  const found = [];
  for (const e of fs.readdirSync(modules, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name === ".bin") continue;
    if (e.name.startsWith("@")) {
      for (const n of fs.readdirSync(path.join(modules, e.name))) found.push({ name: `${e.name}/${n}`, dir: path.join(modules, e.name, n) });
    } else {
      found.push({ name: e.name, dir: path.join(modules, e.name) });
    }
  }
  return found;
}

// A nested copy of the very package (name and version) that already sits at the top level is
// found by Node at the top level too, so it can go. The top level itself is never touched.
function dedupe(modules, isTop) {
  for (const pkg of packagesIn(modules)) {
    if (!isTop) {
      const v = version(pkg.dir);
      if (v && v === version(path.join(root, pkg.name))) {
        fs.rmSync(pkg.dir, { recursive: true, force: true });
        removedCopies++;
        continue;
      }
    }
    const inner = path.join(pkg.dir, "node_modules");
    if (fs.existsSync(inner)) dedupe(inner, false);
  }
}

// Source maps and type declarations are read by tools, never by the running server. TypeScript's own
// declarations are left alone because it reads them as data.
const dead = /\.(map|d\.ts|d\.mts|d\.cts)$/;
function sweep(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "typescript" && path.basename(dir) === "node_modules") continue;
      sweep(p);
    } else if (dead.test(e.name)) {
      removedBytes += size(p);
      fs.rmSync(p);
      removedFiles++;
    }
  }
}

// The same folders Seerr's own Dockerfile removes from its image.
const heavy = [
  "ace-builds/src-noconflict",
  "ace-builds/src",
  "ace-builds/src-min",
  "country-flag-icons/react",
  "country-flag-icons/string",
  "country-flag-icons/1x1",
  "@heroicons/react/16",
];
function trim(modules) {
  for (const h of heavy) fs.rmSync(path.join(modules, h), { recursive: true, force: true });
  for (const e of fs.readdirSync(modules, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name === ".bin") continue;
    const pkgs = e.name.startsWith("@")
      ? fs.readdirSync(path.join(modules, e.name)).map((n) => path.join(modules, e.name, n))
      : [path.join(modules, e.name)];
    for (const pkg of pkgs) {
      const inner = path.join(pkg, "node_modules");
      if (fs.existsSync(inner)) trim(inner);
    }
  }
}

// A flat install still repeats a package under every package that wants a slightly different
// version of it than the one at the top. Here 39 packages each carry their own 3.48 of react-aria
// next to the 3.47 at the top, over a hundred thousand files. When one name@version is nested in
// three or more places, one copy moves up to the folder they all share, where every one of them
// finds it, and the others go. It is only done when nothing is lost: the copy sits alone in its
// folder, and every package below the shared folder that asks for the package accepts that version.
let sharedCopies = 0;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

// Every package that sits inside another one, with the package that holds it.
function nestedPackages(modules, owner, out) {
  for (const pkg of packagesIn(modules)) {
    if (owner) out.push({ ...pkg, owner, modules });
    const inner = path.join(pkg.dir, "node_modules");
    if (fs.existsSync(inner)) nestedPackages(inner, pkg.dir, out);
  }
  return out;
}

function commonDir(dirs) {
  const parts = dirs.map((d) => path.resolve(d).split(path.sep));
  let n = 0;
  while (parts.every((p) => p.length > n && p[n] === parts[0][n])) n++;
  return parts[0].slice(0, n).join(path.sep);
}

// Every package under dir that lists name as a dependency, with the range it asks for.
function wantsOf(dir, name, found = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name === ".bin") continue;
    const sub = path.join(dir, e.name);
    if (e.name.startsWith("@") && path.basename(dir) === "node_modules") {
      wantsOf(sub, name, found);
      continue;
    }
    if (e.name === "node_modules") {
      wantsOf(sub, name, found);
      continue;
    }
    const pj = readJson(path.join(sub, "package.json"));
    if (pj) {
      const range = { ...pj.peerDependencies, ...pj.optionalDependencies, ...pj.dependencies }[name];
      if (range) found.push({ dir: sub, range });
    }
    const inner = path.join(sub, "node_modules");
    if (fs.existsSync(inner)) wantsOf(inner, name, found);
  }
  return found;
}

function shareNested() {
  let semver;
  try {
    semver = createRequire(path.join(root, "x.js"))("semver");
  } catch {
    console.log("semver is not installed, nested copies are left as they are");
    return;
  }
  const groups = new Map();
  for (const n of nestedPackages(root, null, [])) {
    const v = version(n.dir);
    if (!v) continue;
    if (!groups.has(v)) groups.set(v, []);
    groups.get(v).push(n);
  }
  for (const [id, copies] of groups) {
    if (copies.length < 3) continue;
    const name = copies[0].name;
    const ver = id.slice(name.length + 1);
    // Each copy must be the only package in its folder, or moving it changes what its folder offers.
    if (!copies.every((c) => packagesIn(c.modules).length === 1)) continue;
    const shared = commonDir(copies.map((c) => c.owner));
    const base = path.resolve(root);
    if (!shared.startsWith(base + path.sep) || shared === base) continue;
    const target = path.join(shared, "node_modules", name);
    if (fs.existsSync(target)) continue;
    // Everything below the shared folder would now find this version, so all of it must accept it.
    const movedDirs = new Set(copies.map((c) => path.resolve(c.dir)));
    const wants = wantsOf(shared, name).filter((w) => !movedDirs.has(path.resolve(w.dir)));
    if (!wants.every((w) => semver.satisfies(ver, w.range))) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.renameSync(copies[0].dir, target);
    for (const c of copies.slice(1)) fs.rmSync(c.dir, { recursive: true, force: true });
    for (const c of copies) {
      if (fs.existsSync(c.modules) && fs.readdirSync(c.modules).filter((f) => f !== ".bin").length === 0) fs.rmSync(c.modules, { recursive: true, force: true });
    }
    sharedCopies += copies.length - 1;
    console.log(`shared ${id}: ${copies.length} copies became 1 in ${path.relative(base, shared)}`);
  }
}

dedupe(root, true);
shareNested();
sweep(root);
trim(root);
const left = packagesIn(root).length;
if (left < 300) {
  console.error(`only ${left} packages left in node_modules, something is wrong`);
  process.exit(1);
}
console.log(`pruned ${removedCopies} duplicate packages, shared ${sharedCopies} more, and ${removedFiles} files (${Math.round(removedBytes / 1048576)} MB of maps and types)`);
