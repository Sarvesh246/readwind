import {
  readFileSync,
  readdirSync,
  writeFileSync,
  realpathSync,
} from "node:fs";
import { resolve, join, relative } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { zipSync, strToU8 } from "fflate";
import sharp from "sharp";
const [checkout, output, requiredLetters] = process.argv.slice(2);
if (!checkout || !output)
  throw new Error(
    "Usage: node scripts/catalog/package-standard-ebook.mjs <public sparse checkout> <output.epub> [required letter count]",
  );
const directory = realpathSync(checkout),
  root = realpathSync(join(directory, "src"));
if (relative(directory, root).startsWith(".."))
  throw new Error("Source directory escapes the verified checkout.");
const git = (...args) =>
  execFileSync("git", ["-C", directory, ...args], { encoding: "utf8" }).trim();
const remote = git("remote", "get-url", "origin"),
  commit = git("rev-parse", "HEAD");
if (
  !/^https:\/\/github\.com\/standardebooks\/[a-z0-9_-]+(?:\.git)?$/i.test(
    remote,
  )
)
  throw new Error(
    "A verified public Standard Ebooks source checkout is required.",
  );
const license = readFileSync(join(directory, "LICENSE.md"), "utf8");
if (!license.includes("https://creativecommons.org/publicdomain/zero/1.0/"))
  throw new Error("Source contribution license needs review.");
const files = { mimetype: [strToU8("application/epub+zip"), { level: 0 }] },
  originals = [];
async function walk(folder) {
  for (const entry of readdirSync(folder, { withFileTypes: true }).sort(
    (a, b) => a.name.localeCompare(b.name, "en"),
  )) {
    if (entry.isSymbolicLink())
      throw new Error("Source symlinks are not supported.");
    const path = join(folder, entry.name);
    if (entry.isDirectory()) {
      await walk(path);
      continue;
    }
    const name = relative(root, path).replaceAll("\\", "/");
    if (name === "mimetype") continue;
    const bytes = readFileSync(path);
    if (bytes.length > 20 * 1024 * 1024)
      throw new Error("Source resource exceeds import limits.");
    originals.push({
      path: name,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    files[name] = bytes;
    if (/^epub\/images\/[^/]+\.svg$/.test(name)) {
      const svg = bytes.toString();
      if (
        /<script|foreignObject|<!DOCTYPE|<!ENTITY|@import|url\(\s*["']?(?!#|data:image\/(?:jpeg|png|webp);base64,)/i.test(
          svg,
        ) ||
        [...svg.matchAll(/\b(?:xlink:)?href\s*=\s*["']([^"']*)["']/gi)].some(
          (match) =>
            !/^(?:#|data:image\/(?:jpeg|png|webp);base64,)/i.test(match[1]),
        )
      )
        throw new Error(
          "Cover SVG contains unsupported external or active resources.",
        );
      files[name.replace(/\.svg$/, ".png")] = await sharp(bytes)
        .png()
        .toBuffer();
    }
  }
}
await walk(root);
const images = Object.keys(files).filter((name) => name.endsWith(".svg"));
for (const name of Object.keys(files).filter((name) =>
  /\.(xhtml|opf|xml|css)$/.test(name),
)) {
  let text = Buffer.from(files[name]).toString();
  for (const image of images) {
    const local = image.replace(/^epub\//, "");
    text = text
      .replaceAll(`../${local}`, `../${local.replace(/\.svg$/, ".png")}`)
      .replaceAll(`"${local}"`, `"${local.replace(/\.svg$/, ".png")}"`);
  }
  if (name.endsWith(".opf"))
    text = text.replaceAll("image/svg+xml", "image/png");
  files[name] = Buffer.from(text);
}
if (requiredLetters) {
  const count = Number(requiredLetters);
  if (!Number.isInteger(count) || count < 1 || count > 1000)
    throw new Error("Invalid letter inventory.");
  const opf = Buffer.from(files["epub/content.opf"]).toString();
  const manifest = new Map(
    [...opf.matchAll(/<item\b[^>]*>/g)].map((match) => [
      match[0].match(/\bhref="([^"]+)"/)?.[1],
      match[0].match(/\bid="([^"]+)"/)?.[1],
    ]),
  );
  const spine = new Set(
    [...opf.matchAll(/<itemref\b[^>]*\bidref="([^"]+)"/g)].map(
      (match) => match[1],
    ),
  );
  for (let number = 1; number <= count; number++)
    if (
      !files[`epub/text/letter-${number}.xhtml`] ||
      !spine.has(manifest.get(`text/letter-${number}.xhtml`))
    )
      throw new Error(`Missing letter ${number} from the source spine.`);
}
const bytes = zipSync(files, { mtime: new Date(1980, 0, 1) });
writeFileSync(resolve(output), bytes);
writeFileSync(
  resolve(output) + ".provenance.json",
  JSON.stringify(
    {
      remote,
      commit,
      sourceFiles: originals,
      resourceNormalization:
        "Source SVGs rasterized faithfully to PNG; local image references updated. All source prose and spine order retained.",
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output: resolve(output),
    bytes: bytes.length,
    sourceFiles: originals.length,
    commit,
  }),
);
