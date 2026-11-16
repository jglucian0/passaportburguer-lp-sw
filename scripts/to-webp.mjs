/*
 * Converte todas as imagens de public/ (png, jpg, jpeg, gif, tiff, avif, heic*, bmp) para .webp.
 *
 * Uso:
 *   npm run img:webp                      # converte tudo em public/, mantém os originais
 *   npm run img:webp -- public/lanches    # só uma pasta
 *   npm run img:webp -- --delete          # apaga o original depois de converter
 *   npm run img:webp -- --quality 80 --max 800 --force
 *
 * Opções:
 *   --quality N   qualidade WebP 1-100 (padrão 80)
 *   --max N       reduz para no máximo N px no lado maior (nunca amplia; padrão: não redimensiona)
 *   --delete      remove o arquivo original após converter
 *   --force       reconverte mesmo se o .webp já existir e estiver atualizado
 *
 * Atenção: o código referencia alguns arquivos .png/.jpg (logo, cards, carimbos).
 * Ao usar --delete nessas pastas, atualize os caminhos no código.
 */
import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const EXT = new Set([".png", ".jpg", ".jpeg", ".jfif", ".gif", ".tif", ".tiff", ".avif", ".bmp", ".heic", ".heif"]);

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback;
};
const valueArgs = new Set(["--quality", "--max"]);
const target = args.find((a, i) => !a.startsWith("--") && !valueArgs.has(args[i - 1])) ?? "public";

const quality = value("quality", 80);
const max = value("max", 0);
const del = flag("delete");
const force = flag("force");

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
let converted = 0, skipped = 0, failed = 0, before = 0, after = 0;

for await (const file of walk(path.resolve(target))) {
  if (!EXT.has(path.extname(file).toLowerCase())) continue;
  const out = file.replace(/\.[^.]+$/, ".webp");
  const rel = path.relative(process.cwd(), file);
  try {
    const src = await stat(file);
    const dst = await stat(out).catch(() => null);
    if (dst && dst.mtimeMs >= src.mtimeMs && !force) {
      skipped++;
      if (del) await unlink(file);
      continue;
    }
    let img = sharp(file, { animated: true }).rotate();
    if (max) img = img.resize({ width: max, height: max, fit: "inside", withoutEnlargement: true });
    await img.webp({ quality, effort: 5 }).toFile(out);
    const size = (await stat(out)).size;
    before += src.size;
    after += size;
    converted++;
    console.log(`✔ ${rel}  ${kb(src.size)} → ${kb(size)}`);
    if (del) await unlink(file);
  } catch (err) {
    failed++;
    console.error(`✖ ${rel}: ${err.message}`);
  }
}

console.log(`\n${converted} convertida(s), ${skipped} já atualizada(s), ${failed} com erro.`);
if (converted) console.log(`Total: ${kb(before)} → ${kb(after)}`);
if (failed) process.exitCode = 1;
