// Next's build leaves hashed aliases (react-markdown-8188ad93d1c1e2fa) in .next/node_modules, links
// into pnpm's store that the server loads by that name. The bundle uses a flat node_modules with no
// links, so each alias becomes a real copy of the package it pointed to.
//
//   node seerr-bundle-links.mjs <built Seerr folder> <staged app folder>
import fs from "node:fs";
import path from "node:path";

const [built, staged] = process.argv.slice(2);
if (!built || !staged) {
  console.error("usage: seerr-bundle-links.mjs <built Seerr folder> <staged app folder>");
  process.exit(1);
}

const aliases = path.join(built, ".next", "node_modules");
if (!fs.existsSync(aliases)) process.exit(0);

// The package an alias pointed to is whatever follows the last node_modules in its target.
function packageOf(target) {
  const parts = target.replaceAll("\\", "/").split("/");
  const i = parts.lastIndexOf("node_modules");
  if (i < 0 || i === parts.length - 1) throw new Error(`cannot tell the package from ${target}`);
  const name = parts[i + 1];
  return name.startsWith("@") ? `${name}/${parts[i + 2]}` : name;
}

function* entries(dir, rel = "") {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const here = path.join(dir, e.name);
    const name = rel ? `${rel}/${e.name}` : e.name;
    if (e.isSymbolicLink()) yield { name, target: fs.readlinkSync(here) };
    else if (e.isDirectory() && e.name.startsWith("@")) yield* entries(here, name);
  }
}

let count = 0;
for (const { name, target } of entries(aliases)) {
  const pkg = packageOf(target);
  const from = path.join(staged, "node_modules", pkg);
  if (!fs.existsSync(path.join(from, "package.json"))) {
    throw new Error(`alias ${name} points to ${pkg}, which the production install does not have`);
  }
  const to = path.join(staged, ".next", "node_modules", name);
  fs.rmSync(to, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true, dereference: true });
  count++;
}
console.log(`resolved ${count} aliases`);
