'use client';

import { useEffect, useState } from 'react';
import {
  ShoppingCart,
  TrendingUp,
  BarChart3,
  Ticket,
  DollarSign,
  Percent,
  ChevronDown,
  ChevronUp,
  Filter,
} from 'lucide-react';

interface SaleRecord {
  _id: string;
  orderId: number;
  eventId: string;
  eventName: string;
  venue: string;
  eventDateTime: string;
  section: string;
  row: string;
  seatFrom: string;
  seatTo: string;
  quantity: number;
  pricePerTicket: number;
  totalProceeds: number;
  saleCreatedAt: string;
  snapshot: {
    eventAvailableSeats: number;
    eventVenueCapacity: number;
    eventAvailabilityPct: number | null;
    sectionTotalSeats: number;
    sectionTotalGroups: number;
    sectionPctOfVenue: number | null;
  };
}

interface Bucket {
  _id: number | string;
  count: number;
  totalTickets: number;
  avgPrice: number;
  totalRevenue: number;
  events: string[];
}

interface EventSummary {
  _id: string;
  eventName: string;
  venue: string;
  eventDateTime: string;
  totalSales: number;
  totalTickets: number;
  totalRevenue: number;
  avgAvailabilityPct: number;
  minAvailabilityPct: number;
  maxAvailabilityPct: number;
  sections: string[];
}

function bucketLabel(id: number | string): string {
  if (id === 'unknown') return 'N/A';
  const n = Number(id);
  const upper = n + 10;
  return `${n}–${upper > 100 ? '100+' : upper}%`;
}

function pctColor(pct: number | null | undefined): string {
  if (pct === null || pct === undefined) return 'text-slate-400';
  if (pct >= 80) return 'text-emerald-600';
  if (pct >= 50) return 'text-amber-600';
  if (pct >= 25) return 'text-orange-600';
  return 'text-red-600';
}

function pctBg(pct: number | null | undefined): string {
  if (pct === null || pct === undefined) return 'bg-slate-50 border-slate-200';
  if (pct >= 80) return 'bg-emerald-50 border-emerald-200';
  if (pct >= 50) return 'bg-amber-50 border-amber-200';
  if (pct >= 25) return 'bg-orange-50 border-orange-200';
  return 'bg-red-50 border-red-200';
}

export default function SalesPage() {
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [eventSummaries, setEventSummaries] = useState<EventSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filterEvent, setFilterEvent] = useState('');
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null);

  useEffect(() => {
    fetchSales();
  }, [filterEvent]);

  async function fetchSales() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterEvent) params.set('eventId', filterEvent);
      params.set('limit', '200');

      const res = await fetch(`/api/sales?${params.toString()}`);
      const data = await res.json();

      setSales(data.sales || []);
      setBuckets(data.analytics?.buckets || []);
      setEventSummaries(data.analytics?.eventSummaries || []);
      setTotal(data.total || 0);
    } catch (err) {
      console.error('Failed to fetch sales:', err);
    } finally {
      setLoading(false);
    }
  }

  const totalRevenue = sales.reduce((sum, s) => sum + (s.totalProceeds || 0), 0);
  const totalTickets = sales.reduce((sum, s) => sum + (s.quantity || 0), 0);

  // Find the max bucket count for bar chart scaling
  const maxBucketCount = Math.max(...buckets.map((b) => b.totalTickets), 1);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Sales Analytics</h1>
          <p className="text-sm text-slate-500 mt-1">
            Track orders and analyze sales by inventory availability levels
          </p>
        </div>
        <div className="flex items-center gap-3">
          {filterEvent && (
            <button
              onClick={() => setFilterEvent('')}
              className="text-xs px-3 py-1.5 rounded-lg bg-purple-50 text-purple-600 border border-purple-200 hover:bg-purple-100 transition-colors"
            >
              Clear filter
            </button>
          )}
          <div className="text-sm text-slate-400">
            {total} total sale{total !== 1 ? 's' : ''}
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-purple-50 border border-purple-100 flex items-center justify-center">
              <ShoppingCart className="w-5 h-5 text-purple-500" />
            </div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Sales</p>
          </div>
          <p className="text-2xl font-bold text-slate-800">{total}</p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center">
              <Ticket className="w-5 h-5 text-blue-500" />
            </div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Tickets Sold</p>
          </div>
          <p className="text-2xl font-bold text-slate-800">{totalTickets}</p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-emerald-500" />
            </div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Revenue</p>
          </div>
          <p className="text-2xl font-bold text-slate-800">
            ${totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-amber-500" />
            </div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Events w/ Sales</p>
          </div>
          <p className="text-2xl font-bold text-slate-800">{eventSummaries.length}</p>
        </div>
      </div>

      {/* ── Sales by Availability % ── */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-5">
          <BarChart3 className="w-5 h-5 text-purple-500" />
          <h2 className="text-lg font-bold text-slate-800">Sales by Inventory Availability %</h2>
        </div>
        <p className="text-xs text-slate-400 mb-4">
          Shows how many tickets sold at each venue availability level. Low % = scarce inventory when sold.
        </p>

        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-6 h-6 border-2 border-purple-300 border-t-purple-600 rounded-full animate-spin" />
          </div>
        ) : buckets.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-8">No sales data yet</p>
        ) : (
          <div className="space-y-2">
            {buckets.map((bucket) => {
              const pct = Math.round((bucket.totalTickets / maxBucketCount) * 100);
              return (
                <div key={String(bucket._id)} className="flex items-center gap-3">
                  <div className="w-20 text-right text-xs font-semibold text-slate-500 shrink-0">
                    {bucketLabel(bucket._id)}
                  </div>
                  <div className="flex-1 h-8 bg-slate-50 rounded-lg overflow-hidden border border-slate-100 relative">
                    <div
                      className="h-full bg-gradient-to-r from-purple-500 to-indigo-500 rounded-lg transition-all duration-500"
                      style={{ width: `${Math.max(pct, 2)}%` }}
                    />
                    <div className="absolute inset-0 flex items-center px-3 justify-between">
                      <span className="text-xs font-bold text-white drop-shadow-sm">
                        {bucket.totalTickets} tix
                      </span>
                      <span className="text-xs font-medium text-slate-500">
                        {bucket.count} sale{bucket.count !== 1 ? 's' : ''} &middot; $
                        {bucket.totalRevenue?.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Per-Event Summary ── */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-5">
          <Percent className="w-5 h-5 text-indigo-500" />
          <h2 className="text-lg font-bold text-slate-800">Events by Sell-Through Level</h2>
        </div>
        <p className="text-xs text-slate-400 mb-4">
          Average venue availability % when tickets sold for each event. Lower = sold when inventory was scarce.
        </p>

        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-6 h-6 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" />
          </div>
        ) : eventSummaries.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-8">No sales data yet</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {eventSummaries.map((ev) => {
              const isExpanded = expandedEvent === ev._id;
              return (
                <div key={ev._id}>
                  <button
                    onClick={() => {
                      setExpandedEvent(isExpanded ? null : ev._id);
                      if (!isExpanded) setFilterEvent(ev._id);
                      else setFilterEvent('');
                    }}
                    className="w-full flex items-center gap-4 py-3 px-2 hover:bg-slate-50 rounded-lg transition-colors text-left"
                  >
                    <div
                      className={`w-14 h-14 rounded-xl border flex flex-col items-center justify-center shrink-0 ${pctBg(
                        ev.avgAvailabilityPct
                      )}`}
                    >
                      <span className={`text-lg font-bold leading-none ${pctColor(ev.avgAvailabilityPct)}`}>
                        {ev.avgAvailabilityPct !== null ? Math.round(ev.avgAvailabilityPct) : '?'}
                      </span>
                      <span className="text-[9px] font-semibold text-slate-400 mt-0.5">AVG %</span>
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">{ev.eventName}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {ev.venue} &middot;{' '}
                        {ev.eventDateTime
                          ? new Date(ev.eventDateTime).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            })
                          : 'TBD'}
                      </p>
                    </div>

                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold text-slate-700">
                        {ev.totalSales} sale{ev.totalSales !== 1 ? 's' : ''}
                      </p>
                      <p className="text-xs text-slate-400">
                        {ev.totalTickets} tix &middot; $
                        {ev.totalRevenue?.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </p>
                    </div>

                    <div className="shrink-0 text-slate-300">
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="pl-20 pb-4 pr-4">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                        <div>
                          <p className="text-slate-400 font-semibold uppercase tracking-wider">Availability Range</p>
                          <p className="text-slate-700 font-bold mt-1">
                            {ev.minAvailabilityPct !== null ? `${Math.round(ev.minAvailabilityPct)}%` : '?'} –{' '}
                            {ev.maxAvailabilityPct !== null ? `${Math.round(ev.maxAvailabilityPct)}%` : '?'}
                          </p>
                        </div>
                        <div>
                          <p className="text-slate-400 font-semibold uppercase tracking-wider">Sections Sold</p>
                          <p className="text-slate-700 font-bold mt-1">{ev.sections?.join(', ') || 'N/A'}</p>
                        </div>
                        <div>
                          <p className="text-slate-400 font-semibold uppercase tracking-wider">Avg Price</p>
                          <p className="text-slate-700 font-bold mt-1">
                            ${ev.totalTickets > 0 ? (ev.totalRevenue / ev.totalTickets).toFixed(2) : '0'}
                          </p>
                        </div>
                        <div>
                          <p className="text-slate-400 font-semibold uppercase tracking-wider">Total Revenue</p>
                          <p className="text-slate-700 font-bold mt-1">
                            ${ev.totalRevenue?.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Recent Sales Table ── */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-5">
          <Filter className="w-5 h-5 text-slate-400" />
          <h2 className="text-lg font-bold text-slate-800">Recent Sales</h2>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-6 h-6 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
          </div>
        ) : sales.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-8">
            No sales recorded yet. Sales will appear here once the poller picks up orders from Automatiq Sync.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left py-2 px-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    Event
                  </th>
                  <th className="text-left py-2 px-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    Section / Row
                  </th>
                  <th className="text-center py-2 px-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    Qty
                  </th>
                  <th className="text-right py-2 px-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    Price
                  </th>
                  <th className="text-center py-2 px-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    Event Avail %
                  </th>
                  <th className="text-center py-2 px-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    Section Seats
                  </th>
                  <th className="text-right py-2 px-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    Date
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {sales.map((sale) => (
                  <tr key={sale._id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-2.5 px-2">
                      <p className="font-medium text-slate-700 truncate max-w-[200px]">{sale.eventName}</p>
                    </td>
                    <td className="py-2.5 px-2 text-slate-600">
                      {sale.section}
                      {sale.row ? ` / Row ${sale.row}` : ''}
                    </td>
                    <td className="py-2.5 px-2 text-center font-semibold text-slate-700">{sale.quantity}</td>
                    <td className="py-2.5 px-2 text-right text-slate-600">
                      {sale.pricePerTicket ? `$${sale.pricePerTicket.toFixed(2)}` : '–'}
                    </td>
                    <td className="py-2.5 px-2 text-center">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold border ${pctBg(
                          sale.snapshot?.eventAvailabilityPct
                        )} ${pctColor(sale.snapshot?.eventAvailabilityPct)}`}
                      >
                        {sale.snapshot?.eventAvailabilityPct !== null &&
                        sale.snapshot?.eventAvailabilityPct !== undefined
                          ? `${sale.snapshot.eventAvailabilityPct}%`
                          : 'N/A'}
                      </span>
                    </td>
                    <td className="py-2.5 px-2 text-center text-slate-500 text-xs">
                      {sale.snapshot?.sectionTotalSeats ?? '–'}
                    </td>
                    <td className="py-2.5 px-2 text-right text-xs text-slate-400">
                      {sale.saleCreatedAt
                        ? new Date(sale.saleCreatedAt).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : '–'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
