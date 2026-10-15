#!/usr/bin/env node
/**
 * Bakes the current public mortgage rates into the HTML of the Compare NZ
 * Mortgage Rates page, so crawlers that don't run JavaScript (ChatGPT, Claude,
 * Perplexity and most other AI fetchers) see real rates, not the
 * "Connecting to the market..." placeholder.
 *
 * Source : the client's public-only Apps Script CSV (same feed the table uses).
 * Target : the `overview` rich-text field of the "Compare NZ Mortgage Rates"
 *          item in the Tools CMS collection. Only the rows between the
 *          snapshot marker comments inside <tbody id="table-body"> change.
 *          The live table script still replaces them with fresh data in the
 *          browser.
 * Publish: that single CMS item only. Never a full site publish.
 *
 * Never writes a bad snapshot: if the feed fails or looks wrong, nothing is
 * written, the last good snapshot stays live, and the job exits non-zero so
 * the failure shows in GitHub.
 *
 * Env:
 *   WEBFLOW_API_TOKEN  site token with CMS read + write (the only secret)
 *   RATES_FEED_URL, WEBFLOW_COLLECTION_ID, WEBFLOW_ITEM_ID  public identifiers
 *   DRY_RUN=1          build and print the snapshot, write nothing
 *   OVERVIEW_FILE=path read the current field from a file instead of Webflow
 *                      (local testing; implies DRY_RUN)
 */

import { readFile } from 'node:fs/promises';

const FEED_URL = process.env.RATES_FEED_URL;
const TOKEN = process.env.WEBFLOW_API_TOKEN;
const COLLECTION_ID = process.env.WEBFLOW_COLLECTION_ID;
const ITEM_ID = process.env.WEBFLOW_ITEM_ID;
const OVERVIEW_FILE = process.env.OVERVIEW_FILE;
const DRY_RUN = process.env.DRY_RUN === '1' || Boolean(OVERVIEW_FILE);

const FIELD = 'overview';
const START = '<!-- hlf-rates-snapshot:start -->';
const END = '<!-- hlf-rates-snapshot:end -->';
// Webflow caps rich-text custom code at 50,000 characters. Leave headroom.
const MAX_FIELD_CHARS = 45000;

// ---- Feed shape (mirrors the table script in the rates master) ----------

const EXPECTED_HEADER = ['last updated', 'bank name', 'rate type', '6 month', '1 year',
  '18 month', '2 year', '3 year', '4 year', '5 year', 'floating'];
const INDEX_TIMESTAMP = 0;
const INDEX_BANK = 1;
const INDEX_CATEGORY = 2;

const rateColumns = [
  { label: '6 Months', index: 3 },
  { label: '1 Year', index: 4 },
  { label: '18 Months', index: 5 },
  { label: '2 Years', index: 6 },
  { label: '3 Years', index: 7 },
  { label: '4 Years', index: 8 },
  { label: '5 Years', index: 9 },
  { label: 'Floating', index: 10 },
];

const bankSortOrder = [
  'ANZ', 'BNZ', 'ASB', 'Westpac', 'Kiwibank', 'SBS Bank', 'SBS Bank FHB Special',
  'Co-operative Bank', 'Co-operative Bank FHB Special', 'China Construction Bank', 'Bank of China',
];

const approvedLenders = [
  { brand: 'ANZ', aliases: ['anz'], type: 'standard' },
  { brand: 'ASB', aliases: ['asb'], type: 'standard' },
  { brand: 'Westpac', aliases: ['westpac'], type: 'standard' },
  { brand: 'BNZ', aliases: ['bnz', 'bank of new zealand', 'bank of nz'], type: 'standard' },
  { brand: 'Kiwibank', aliases: ['kiwibank'], type: 'standard' },
  { brand: 'Co-operative Bank', aliases: ['co-operative', 'cooperative', 'co-op'], type: 'standard' },
  { brand: 'Co-operative Bank', fhbSubtitle: '(First Home Buyers Only)', aliases: ['co-operative', 'cooperative', 'co-op'], type: 'fhb' },
  { brand: 'TSB', aliases: ['tsb'], type: 'standard' },
  { brand: 'SBS Bank', aliases: ['sbs'], type: 'standard' },
  { brand: 'SBS Bank', fhbSubtitle: '(First Home Buyers Only)', aliases: ['sbs'], type: 'fhb' },
  { brand: 'Bank of China', aliases: ['bank of china'], type: 'standard' },
  { brand: 'China Construction Bank', aliases: ['china construction', 'ccb'], type: 'standard' },
  { brand: 'Nelson Building Society', aliases: ['nelson', 'nbs'], type: 'standard' },
  { brand: 'Wairarapa Building Society', aliases: ['wairarapa', 'wbs'], type: 'standard' },
  { brand: 'Unity', aliases: ['unity'], type: 'standard' },
  { brand: 'Unity', fhbSubtitle: '(First Home Buyers Only)', aliases: ['unity'], type: 'fhb' },
];

const isAdvertised = cat => cat.includes('advertised');
const isFhb = cat => cat.includes('fhb') || cat.includes('first home');

// ---- Fetch + validate ----------------------------------------------------

function parseCsv(text) {
  return text.split(/\r?\n/).filter(line => line.trim() !== '').map(row => {
    let inQuotes = false, entries = [], current = '';
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (ch === '"' && row[i + 1] === '"' && inQuotes) { current += '"'; i++; }
      else if (ch === '"') inQuotes = !inQuotes;
      else if (ch === ',' && !inQuotes) { entries.push(current.trim()); current = ''; }
      else current += ch;
    }
    entries.push(current.trim());
    return entries;
  });
}

async function fetchFeed() {
  const res = await fetch(FEED_URL, { redirect: 'follow', signal: AbortSignal.timeout(30000) });
  const body = await res.text();
  if (!res.ok) throw new Error(`Feed returned HTTP ${res.status}: ${body.slice(0, 200)}`);
  const head = body.trim().toLowerCase();
  if (head.startsWith('<!doctype') || head.startsWith('<html')) {
    throw new Error('Feed returned an HTML page instead of CSV (sign-in page or script error).');
  }
  return parseCsv(body);
}

/**
 * Guard rails. The feed is meant to carry public advertised and FHB special
 * rates only. Anything else (a renamed column, a discounted tier, an empty
 * sheet) stops the run so nothing private or broken reaches the page.
 */
function validate(rows) {
  const problems = [];
  const header = (rows[0] || []).map(h => h.toLowerCase().replace(/\s+/g, ' ').trim());
  if (header.join('|') !== EXPECTED_HEADER.join('|')) {
    problems.push(`Unexpected columns: ${rows[0]?.join(', ')}`);
  }
  const data = rows.slice(1);
  if (data.length < 5 || data.length > 40) problems.push(`Implausible row count: ${data.length}`);

  data.forEach((row, i) => {
    const cat = (row[INDEX_CATEGORY] || '').toLowerCase();
    if (!isAdvertised(cat) && !isFhb(cat)) {
      problems.push(`Row ${i + 2} has category "${row[INDEX_CATEGORY]}", expected Advertised or FHB Special only`);
    }
    rateColumns.forEach(col => {
      const raw = (row[col.index] || '').trim();
      if (raw === '') return;
      const n = parseFloat(raw.replace(/[^0-9.]/g, ''));
      if (isNaN(n) || n < 1 || n > 20) problems.push(`Row ${i + 2} ${col.label} rate looks wrong: "${raw}"`);
    });
  });
  return { data, problems };
}

// ---- Render (same rules as the table script) ------------------------------

function nzDate(value) {
  let d = new Date(value);
  if (isNaN(d.getTime())) {
    const parts = String(value).split(/[ T]/)[0].split('/');
    if (parts.length === 3) d = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
  }
  if (isNaN(d.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat('en-NZ', {
    timeZone: 'Pacific/Auckland', day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(d);
}

function buildRows(data) {
  const finalBankData = [];
  approvedLenders.forEach(lender => {
    const matches = data.filter(row => {
      const bankMatch = lender.aliases.some(a => (row[INDEX_BANK] || '').toLowerCase().includes(a));
      const cat = (row[INDEX_CATEGORY] || '').toLowerCase();
      return bankMatch && (lender.type === 'fhb' ? isFhb(cat) : isAdvertised(cat));
    });
    if (!matches.length) return;
    const row = [...matches[matches.length - 1]];
    row.brand = lender.brand;
    row.type = lender.type;
    row.fhbSubtitle = lender.fhbSubtitle;
    const hasData = rateColumns.some(col => {
      const v = parseFloat((row[col.index] || '').replace(/[^0-9.]/g, ''));
      return !isNaN(v) && v > 0;
    });
    if (hasData) finalBankData.push(row);
  });

  const lowest = {};
  rateColumns.forEach(col => {
    let min = Infinity;
    finalBankData.forEach(row => {
      if (row.type === 'fhb') return;
      if (row.brand === 'Kiwibank' && col.label === '18 Months') return;
      const v = parseFloat((row[col.index] || '').replace(/[^0-9.]/g, ''));
      if (!isNaN(v) && v > 0 && v < min) min = v;
    });
    lowest[col.index] = min;
  });

  const sortName = r => (r.type === 'fhb' ? `${r.brand} FHB Special` : r.brand);
  finalBankData.sort((a, b) => {
    let ia = bankSortOrder.indexOf(sortName(a));
    let ib = bankSortOrder.indexOf(sortName(b));
    if (ia === -1) ia = 999;
    if (ib === -1) ib = 999;
    return ia !== ib ? ia - ib : sortName(a).localeCompare(sortName(b));
  });

  return finalBankData.map(row => {
    const name = row.type === 'fhb'
      ? `${row.brand} <span class="hlf-fhb-label">${row.fhbSubtitle}</span>`
      : row.brand;
    const cells = rateColumns.map(col => {
      const cls = col.label === 'Floating' ? ' class="hlf-floating-col"' : '';
      if (row.brand === 'Kiwibank' && col.label === '18 Months') {
        return `<td${cls}><span class="hlf-not-offered">Not Offered</span></td>`;
      }
      let text = (row[col.index] || '').replace(/[^0-9.%]/g, '').trim();
      const value = parseFloat(text);
      if (text === '' || text === '.' || isNaN(value)) {
        return `<td${cls}>${row.type === 'fhb' ? '' : '<span class="hlf-poa">P.O.A</span>'}</td>`;
      }
      if (!text.includes('%')) text += '%';
      if (value === lowest[col.index] && row.type !== 'fhb') {
        return `<td${cls}><span class="hlf-best-rate" style="display: block; padding: 6px 10px;">${text}</span></td>`;
      }
      return `<td${cls}>${text}</td>`;
    }).join('');
    return `<tr><td class="hlf-bank-name">${name}</td>${cells}<td class="hlf-date-col">${nzDate(row[INDEX_TIMESTAMP])}</td></tr>`;
  });
}

// ---- Merge into the CMS field ----------------------------------------------

function mergeSnapshot(overview, rowsHtml) {
  const block = `${START}\n${rowsHtml.join('\n')}\n${END}`;
  const s = overview.indexOf(START);
  const e = overview.indexOf(END);
  if (s !== -1 && e > s) {
    return overview.slice(0, s) + block + overview.slice(e + END.length);
  }
  if (s !== -1 || e !== -1) throw new Error('Only one snapshot marker found in the field. Fix the embed by hand.');

  // First run: swap the placeholder rows for the marked snapshot block.
  const open = '<tbody id="table-body">';
  const o = overview.indexOf(open);
  const c = overview.indexOf('</tbody>', o);
  if (o === -1 || c === -1 || overview.indexOf(open, o + 1) !== -1) {
    throw new Error('Could not find exactly one <tbody id="table-body"> in the field.');
  }
  return overview.slice(0, o + open.length) + '\n' + block + '\n      ' + overview.slice(c);
}

// ---- Webflow Data API v2 ----------------------------------------------------

async function webflow(path, init = {}) {
  const res = await fetch(`https://api.webflow.com/v2${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      accept: 'application/json',
      ...init.headers,
    },
    signal: AbortSignal.timeout(30000),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Webflow ${init.method || 'GET'} ${path} returned HTTP ${res.status}: ${body.slice(0, 300)}`);
  return body ? JSON.parse(body) : {};
}

async function main() {
  for (const [name, value] of Object.entries({ RATES_FEED_URL: FEED_URL })) {
    if (!value) throw new Error(`${name} not set`);
  }
  if (!OVERVIEW_FILE) {
    for (const [name, value] of Object.entries({
      WEBFLOW_API_TOKEN: TOKEN, WEBFLOW_COLLECTION_ID: COLLECTION_ID, WEBFLOW_ITEM_ID: ITEM_ID,
    })) if (!value) throw new Error(`${name} not set`);
  }

  const { data, problems } = validate(await fetchFeed());
  if (problems.length) {
    console.error('Feed failed validation. Nothing written; the last good snapshot stays live.');
    problems.forEach(p => console.error(` - ${p}`));
    process.exit(1);
  }
  const rows = buildRows(data);
  if (rows.length < 5) {
    console.error(`Only ${rows.length} lenders rendered. Nothing written.`);
    process.exit(1);
  }

  const item = OVERVIEW_FILE
    ? { fieldData: { [FIELD]: await readFile(OVERVIEW_FILE, 'utf8') }, isDraft: false, isArchived: false }
    : await webflow(`/collections/${COLLECTION_ID}/items/${ITEM_ID}`);
  if (item.isDraft || item.isArchived) throw new Error('CMS item is a draft or archived. Not touching it.');

  const current = item.fieldData?.[FIELD];
  if (typeof current !== 'string' || !current.includes('id="live-rate-table"')) {
    throw new Error(`Field "${FIELD}" does not contain the rates table embed. Not touching it.`);
  }
  const next = mergeSnapshot(current, rows);
  if (next.length > MAX_FIELD_CHARS) throw new Error(`Field would be ${next.length} characters, over the ${MAX_FIELD_CHARS} safety cap.`);

  console.log(`${rows.length} lenders rendered. Field length ${current.length} -> ${next.length}.`);
  if (next === current) {
    console.log('Snapshot unchanged. Nothing to publish.');
    return;
  }
  if (DRY_RUN) {
    console.log('DRY RUN: not writing. New snapshot block:\n');
    console.log(next.slice(next.indexOf(START), next.indexOf(END) + END.length));
    return;
  }

  await webflow(`/collections/${COLLECTION_ID}/items/${ITEM_ID}`, {
    method: 'PATCH',
    body: JSON.stringify({ fieldData: { [FIELD]: next } }),
  });
  const pub = await webflow(`/collections/${COLLECTION_ID}/items/publish`, {
    method: 'POST',
    body: JSON.stringify({ itemIds: [ITEM_ID] }),
  });
  if (!pub.publishedItemIds?.includes(ITEM_ID)) {
    throw new Error(`Item updated but not published: ${JSON.stringify(pub).slice(0, 300)}`);
  }
  console.log('Snapshot written and item published (item only, no site publish).');
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
