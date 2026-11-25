import fs from 'node:fs';
import path from 'node:path';

const distDir = path.resolve('dist');
if (!fs.existsSync(distDir)) {
  console.error('dist/ directory does not exist. Run npm run build first.');
  process.exit(1);
}

const forbiddenTokens = [
  '__TERRYMATOR_HARNESS__',
  'mountHarness',
  'StudioHarness',
  'G0_DEMO',
  'F09_EXPORT_CLOCK',
  'F02_HIDDEN_TORSO',
  'F03_PAPER_RECIPE',
  'F04_JOINTED_PUPPET',
  'F06_PARALLAX',
  'F08_ARCHIVE',
];
const allowedUrlPrefixes = [
  'http://www.w3.org/',
  'https://www.w3.org/',
  'http://ns.adobe.com/',
  'https://react.dev/errors/',
  'https://json-schema.org/',
  'http://json-schema.org/',
  'https://www.webmproject.org/',
  'https://aomediacodec.github.io/',
  'http://www.pixijs.com/',
  'http://[${',
];

function walkFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full));
    } else if (/\.(js|mjs|html|css)$/i.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const files = walkFiles(distDir);
if (files.length === 0) {
  console.error('No built assets found in dist/.');
  process.exit(1);
}

let failed = false;
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  for (const token of forbiddenTokens) {
    if (text.includes(token)) {
      console.error(`Forbidden test-harness token "${token}" found in ${file}`);
      failed = true;
    }
  }
  const urlMatches = text.match(/https?:\/\/[^\s"'`)\\<>]+/g) ?? [];
  for (const url of urlMatches) {
    if (!allowedUrlPrefixes.some((prefix) => url.startsWith(prefix))) {
      console.error(`Unexpected external URL "${url}" found in ${file}`);
      failed = true;
    }
  }
}

if (failed) {
  process.exit(1);
}
console.log(`Bundle verification passed across ${files.length} built files.`);
