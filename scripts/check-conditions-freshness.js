// scripts/check-conditions-freshness.js
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_AGE_HOURS = Number(process.env.MAX_AGE_HOURS || 6);
const db = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'surfline-conditions.json'), 'utf8'));
let newest = null;
for (const entry of Object.values(db.conditions || {})) {
  const t = Date.parse(entry.fetchedAt || '');
  if (Number.isFinite(t) && (newest === null || t > newest)) newest = t;
}
const ageHours = newest === null ? Infinity : (Date.now() - newest) / 3600000;
console.log(`newest surfline conditions: ${ageHours === Infinity ? 'none' : ageHours.toFixed(1) + 'h old'}`);
process.exitCode = ageHours > MAX_AGE_HOURS ? 1 : 0;
