#!/usr/bin/env node
/**
 * Pulls live review counts + ratings for HLF and writes dist/platform-reviews.json.
 *
 * Google     : Places API (New) Place Details, fields rating + userRatingCount.
 *              Needs GOOGLE_MAPS_API_KEY and GOOGLE_PLACE_ID.
 * Trustpilot : public TrustBox data endpoint (the same one Trustpilot's own
 *              widget script calls). No key, no HTML parsing, no bot wall.
 *              Needs TRUSTPILOT_BUSINESS_UNIT_ID.
 *
 * Never writes a broken file: if a source fails or returns something
 * implausible, the previous value is kept and the job exits non-zero so the
 * failure is visible in GitHub instead of silently zeroing the site.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const OUT = 'dist/platform-reviews.json';

const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY;
const GOOGLE_PLACE_ID = process.env.GOOGLE_PLACE_ID;
const TP_BUSINESS_UNIT_ID = process.env.TRUSTPILOT_BUSINESS_UNIT_ID;

// Trustpilot "Micro Combo" TrustBox. Included on every plan, including free.
const TP_TEMPLATE_ID = '56278e9abfbbba0bdcd568bc';
const TP_LOCALE = 'en-NZ';

const GOOGLE_PROFILE_URL = process.env.GOOGLE_PROFILE_URL || 'https://share.google/Kx2ioMXXilwLbeSac';

const problems = [];

async function getJson(url, init = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) });
  const body = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host} — ${body.slice(0, 200)}`);
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`Non-JSON response from ${new URL(url).host} — ${body.slice(0, 200)}`);
  }
}

async function fetchGoogle() {
  if (!GOOGLE_KEY || !GOOGLE_PLACE_ID) throw new Error('GOOGLE_MAPS_API_KEY or GOOGLE_PLACE_ID not set');
  const data = await getJson(`https://places.googleapis.com/v1/places/${encodeURIComponent(GOOGLE_PLACE_ID)}`, {
    headers: {
      'X-Goog-Api-Key': GOOGLE_KEY,
      'X-Goog-FieldMask': 'rating,userRatingCount,displayName',
    },
  });
  return {
    rating: round1(data.rating),
    count: data.userRatingCount,
    url: GOOGLE_PROFILE_URL,
  };
}

async function fetchTrustpilot() {
  if (!TP_BUSINESS_UNIT_ID) throw new Error('TRUSTPILOT_BUSINESS_UNIT_ID not set');
  const url = `https://widget.trustpilot.com/trustbox-data/${TP_TEMPLATE_ID}`
    + `?businessUnitId=${encodeURIComponent(TP_BUSINESS_UNIT_ID)}&locale=${TP_LOCALE}`;
  const data = await getJson(url);
  const bu = data.businessUnit;
  if (!bu) throw new Error(`No businessUnit in TrustBox payload — ${JSON.stringify(data).slice(0, 200)}`);
  return {
    // trustScore is the exact figure Trustpilot publishes (e.g. 4.4).
    rating: round1(bu.trustScore),
    // stars is Trustpilot's own half-step rounding, used for drawing stars.
    stars: bu.stars,
    count: bu.numberOfReviews?.total,
    label: data.starsString || null,
    url: data.links?.profileUrl || `https://nz.trustpilot.com/review/${bu.identifyingName}`,
  };
}

function round1(n) {
  return typeof n === 'number' ? Math.round(n * 10) / 10 : n;
}

/**
 * Guard rails. A source can legitimately lose a few reviews (moderation,
 * deletions) but a big drop or a zero almost always means a bad response.
 */
function validate(platform, next, prev) {
  const ok = (cond, msg) => { if (!cond) problems.push(`${platform}: ${msg}`); return cond; };
  let valid = true;

  valid = ok(typeof next.rating === 'number' && next.rating > 0 && next.rating <= 5,
    `rating out of range (${next.rating})`) && valid;
  valid = ok(Number.isInteger(next.count) && next.count > 0,
    `review count not a positive integer (${next.count})`) && valid;

  if (valid && prev && Number.isInteger(prev.count)) {
    const floor = Math.min(prev.count - 5, Math.floor(prev.count * 0.9));
    valid = ok(next.count >= floor,
      `review count fell from ${prev.count} to ${next.count}, which looks wrong — keeping previous`) && valid;
  }
  return valid;
}

async function readPrevious() {
  try {
    return JSON.parse(await readFile(OUT, 'utf8'));
  } catch {
    return null;
  }
}

async function main() {
  const prev = await readPrevious();

  const [google, trustpilot] = await Promise.all([
    fetchGoogle().catch(err => { problems.push(`google: ${err.message}`); return null; }),
    fetchTrustpilot().catch(err => { problems.push(`trustpilot: ${err.message}`); return null; }),
  ]);

  const resolve = (name, next, previous) => {
    if (next && validate(name, next, previous)) return next;
    if (previous) return previous;
    return null;
  };

  const out = {
    updated: new Date().toISOString(),
    google: resolve('google', google, prev?.google),
    trustpilot: resolve('trustpilot', trustpilot, prev?.trustpilot),
  };

  if (!out.google && !out.trustpilot) {
    console.error('Both sources failed and there is no previous file to fall back on. Not writing.');
    problems.forEach(p => console.error(` - ${p}`));
    process.exit(1);
  }

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(out, null, 2) + '\n');

  console.log(JSON.stringify(out, null, 2));

  if (problems.length) {
    console.error('\nFinished with problems (previous values kept where needed):');
    problems.forEach(p => console.error(` - ${p}`));
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
