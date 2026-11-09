// Shrinks the flat node_modules of the Seerr bundle. A flat install repeats a package under every
// package that wanted a slightly different peer set: here 40 copies of react-aria, 1 GB. Nothing
// here changes what runs, only what is stored.
//
//   node seerr-bundle-prune.mjs <staged app folder>
import fs from "node:fs";
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

dedupe(root, true);
sweep(root);
trim(root);
const left = packagesIn(root).length;
if (left < 300) {
  console.error(`only ${left} packages left in node_modules, something is wrong`);
  process.exit(1);
}
console.log(`pruned ${removedCopies} duplicate packages and ${removedFiles} files (${Math.round(removedBytes / 1048576)} MB of maps and types)`);
