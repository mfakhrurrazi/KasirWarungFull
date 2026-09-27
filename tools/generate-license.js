#!/usr/bin/env node
/**
 * KasirWarung AI — vendor licence key generator (keep this file private).
 *
 *   node tools/generate-license.js PRO 2027-12-31
 *   node tools/generate-license.js LIF
 *
 * Plans: STD (Standar), PRO (Pro), LIF (Seumur Hidup).
 * Key format: KWAI-<PLAN>-<YYYYMMDD>-<RAND6>-<SIG8>
 * SIG8 = first 8 hex chars (upper case) of HMAC-SHA256("PLAN|YYYYMMDD|RAND6", LICENSE_SECRET).
 * LICENSE_SECRET must match the constant in src/Code.gs — change both before selling.
 */
'use strict';
const crypto = require('crypto');

const LICENSE_SECRET = process.env.KWAI_LICENSE_SECRET || 'KWAI-Piyu-UMKM-2026';

function makeKey(plan, expiry, rand) {
  plan = String(plan || '').toUpperCase();
  if (['STD', 'PRO', 'LIF'].indexOf(plan) < 0) throw new Error('Plan must be STD, PRO or LIF');
  const exp = plan === 'LIF' ? '99991231' : String(expiry || '').replace(/-/g, '');
  if (!/^\d{8}$/.test(exp)) throw new Error('Expiry must be YYYY-MM-DD');
  const r = rand || crypto.randomBytes(6).toString('base64').replace(/[^A-Z0-9]/gi, '').toUpperCase().padEnd(6, 'X').slice(0, 6);
  const sig = crypto.createHmac('sha256', LICENSE_SECRET).update(plan + '|' + exp + '|' + r).digest('hex').slice(0, 8).toUpperCase();
  return 'KWAI-' + plan + '-' + exp + '-' + r + '-' + sig;
}

if (require.main === module) {
  try {
    console.log(makeKey(process.argv[2], process.argv[3]));
  } catch (e) {
    console.error(e.message + '\nUsage: node tools/generate-license.js <STD|PRO|LIF> [YYYY-MM-DD]');
    process.exit(1);
  }
}

module.exports = { makeKey };
