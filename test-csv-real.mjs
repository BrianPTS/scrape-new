/**
 * Real database CSV generation test
 * Connects to MongoDB, fetches up to 100 inventory rows, applies markup adjustments,
 * and writes a sample CSV to test-output.csv
 */

import { MongoClient } from 'mongodb';
import { createWriteStream } from 'fs';
import { resolve } from 'path';

const MONGODB_URI = 'mongodb://absamad:strongPassword123!@178.156.232.161:27017/test?directConnection=true&authSource=admin';
const LIMIT = 100;
const OUTPUT = resolve('test-output.csv');

// ── same formula as csvActions.tsx ──────────────────────────────────────────
function applyAdj(listPrice, defaultPct, adj) {
  if (defaultPct === 0 && adj === 0) return listPrice;
  return listPrice * (1 + (defaultPct + adj) / 100) / (1 + defaultPct / 100);
}

function escapeCsv(val) {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

const COLUMNS = [
  'inventory_id','event_name','venue_name','event_date','event_id',
  'quantity','section','row','seats','barcodes','internal_notes','public_notes',
  'tags','list_price','face_price','taxed_cost','cost',
  'hide_seats','in_hand','in_hand_date','instant_transfer','files_available',
  'split_type','custom_split','stock_type','zone','shown_quantity','passthrough',
  // extra columns for the test so you can verify
  'debug_raw_listPrice','debug_defaultPct','debug_adj','debug_effective_pct',
];

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  console.log('✅ Connected to MongoDB');

  const db = client.db();

  // Aggregate: join ConsecutiveGroup → events to get markup fields
  const pipeline = [
    { $match: {} },
    {
      $lookup: {
        from: 'events',
        localField: 'mapping_id',
        foreignField: 'mapping_id',
        as: 'eventDetails',
      },
    },
    {
      $addFields: {
        event_std_adj:     { $ifNull: [{ $arrayElemAt: ['$eventDetails.standardMarkupAdjustment', 0] }, 0] },
        event_resale_adj:  { $ifNull: [{ $arrayElemAt: ['$eventDetails.resaleMarkupAdjustment', 0] }, 0] },
        event_default_pct: { $ifNull: [{ $arrayElemAt: ['$eventDetails.priceIncreasePercentage', 0] }, 0] },
      },
    },
    { $limit: LIMIT },
  ];

  const docs = await db.collection('consecutivegroups').aggregate(pipeline).toArray();
  console.log(`📦 Fetched ${docs.length} rows from consecutivegroups`);

  const rows = docs.map(doc => {
    const inv = doc.inventory || {};
    const isResale = inv.splitType !== 'NEVERLEAVEONE';
    const rawPrice  = inv.listPrice || 0;
    const defPct    = doc.event_default_pct ?? 0;
    const adj       = isResale ? (doc.event_resale_adj ?? 0) : (doc.event_std_adj ?? 0);
    const adjPrice  = applyAdj(rawPrice, defPct, adj);
    const effPct    = rawPrice > 0 ? (((adjPrice / rawPrice) * (1 + defPct/100)) - 1) * 100 : defPct + adj;

    const seatsStr = (doc.seats || []).map(s => String(s.number)).join(',');
    const inHandStr = inv.inHandDate ? new Date(inv.inHandDate).toISOString().slice(0,10) : '';
    const row = inv.row || '';
    const isSRO = row.toUpperCase() === 'SRO';
    const publicNotes = isSRO
      ? ((inv.publicNotes ? inv.publicNotes + ' - ' : '') + 'STANDING ROOM ONLY')
      : (inv.publicNotes || '');

    return {
      inventory_id:      inv.inventoryId || 0,
      event_name:        doc.event_name || '',
      venue_name:        doc.venue_name || '',
      event_date:        doc.event_date ? new Date(doc.event_date).toISOString() : '',
      event_id:          doc.mapping_id || '',
      quantity:          inv.quantity || 0,
      section:           inv.section || '',
      row:               row,
      seats:             seatsStr,
      barcodes:          inv.barcodes || '',
      internal_notes:    '-tnow -tmplus',
      public_notes:      publicNotes,
      tags:              inv.splitType === 'NEVERLEAVEONE' ? 'STANDARD' : 'RESALE',
      list_price:        Number(adjPrice.toFixed(2)),
      face_price:        Number((inv.cost || 0).toFixed(2)),
      taxed_cost:        Number((inv.cost || 0).toFixed(2)),
      cost:              Number((inv.cost || 0).toFixed(2)),
      hide_seats:        inv.hideSeatNumbers ? 'Y' : 'N',
      in_hand:           'N',
      in_hand_date:      inHandStr,
      instant_transfer:  inv.instant_transfer ? 'Y' : 'N',
      files_available:   'N',
      split_type:        inv.splitType || 'NEVERLEAVEONE',
      custom_split:      '',
      stock_type:        inv.stockType || 'ELECTRONIC',
      zone:              'N',
      shown_quantity:    inv.shown_quantity || '',
      passthrough:       inv.passthrough || '',
      // debug columns
      debug_raw_listPrice:  Number(rawPrice.toFixed(2)),
      debug_defaultPct:     defPct,
      debug_adj:            adj >= 0 ? `+${adj}%` : `${adj}%`,
      debug_effective_pct:  `${defPct + adj}%`,
    };
  });

  const ws = createWriteStream(OUTPUT);
  ws.write(COLUMNS.join(',') + '\n');
  for (const r of rows) {
    ws.write(COLUMNS.map(c => escapeCsv(r[c])).join(',') + '\n');
  }
  ws.end();

  await new Promise(res => ws.on('finish', res));
  await client.close();

  console.log(`\n✅ CSV written to: ${OUTPUT}`);
  console.log(`   Rows: ${rows.length}`);

  // Print a quick summary of the first 5 rows
  console.log('\n── First 5 rows (price columns) ──────────────────────────────────');
  console.log(`${'Event'.padEnd(30)} ${'Type'.padEnd(8)} ${'Raw'.padEnd(8)} ${'Adj%'.padEnd(6)} ${'DefPct'.padEnd(7)} ${'CSV Price'.padEnd(10)}`);
  console.log('─'.repeat(75));
  for (const r of rows.slice(0, 5)) {
    console.log(
      `${String(r.event_name).slice(0,29).padEnd(30)} ` +
      `${String(r.tags).padEnd(8)} ` +
      `${String(r.debug_raw_listPrice).padEnd(8)} ` +
      `${String(r.debug_adj).padEnd(6)} ` +
      `${String(r.debug_defaultPct + '%').padEnd(7)} ` +
      `${String(r.list_price).padEnd(10)}`
    );
  }
  console.log('─'.repeat(75));
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
