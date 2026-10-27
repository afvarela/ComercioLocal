import fs from "node:fs";
import path from "node:path";
import { hash } from "blake3-wasm";

const root = path.resolve(process.argv[2] || "public");
const manifest = {};

function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      visit(absolute);
      continue;
    }
    if (!entry.isFile()) continue;
    const relative = path.relative(root, absolute).split(path.sep).join("/");
    const contents = fs.readFileSync(absolute);
    const extension = path.extname(absolute).slice(1);
    const digest = hash(contents.toString("base64") + extension).toString("hex").slice(0, 32);
    manifest[`/${relative}`] = { hash: digest, size: contents.length };
  }
}

visit(root);
process.stdout.write(JSON.stringify(manifest));
