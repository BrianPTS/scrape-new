'use client';

import React, { useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search, MapPin, Calendar, Tag, DollarSign,
  ChevronLeft, ChevronRight, Loader2, AlertCircle,
  Plus, Check, ExternalLink, Music, Trophy, Theater, X
} from 'lucide-react';
import { searchDiscoveryEvents, checkExistingEvents } from '@/actions/discoveryActions';
import { createEvent } from '@/actions/eventActions';
import type { DiscoveryEvent } from '@/lib/discoveryService';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SearchState {
  keyword: string;
  city: string;
  stateCode: string;
  segmentName: string;
  startDate: string;
  endDate: string;
}

type AddStatus = 'idle' | 'adding' | 'added' | 'error';

interface AddedEventState {
  [eventId: string]: { status: AddStatus; error?: string };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEGMENTS = [
  { value: '', label: 'All Categories' },
  { value: 'Music', label: 'Music', icon: Music },
  { value: 'Sports', label: 'Sports', icon: Trophy },
  { value: 'Arts & Theatre', label: 'Arts & Theatre', icon: Theater },
  { value: 'Film', label: 'Film' },
  { value: 'Miscellaneous', label: 'Miscellaneous' },
];

const PAGE_SIZE = 20;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string) {
  if (!dateStr) return '—';
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatTime(timeStr: string) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':');
  const hour = parseInt(h);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${m} ${ampm}`;
}

function statusBadge(code: string) {
  const styles: Record<string, string> = {
    onsale: 'bg-green-50 text-green-700 border-green-200',
    offsale: 'bg-gray-50 text-gray-600 border-gray-200',
    cancelled: 'bg-red-50 text-red-700 border-red-200',
    postponed: 'bg-amber-50 text-amber-700 border-amber-200',
    rescheduled: 'bg-blue-50 text-blue-700 border-blue-200',
  };
  return styles[code] || 'bg-gray-50 text-gray-600 border-gray-200';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DiscoverEvents() {
  const router = useRouter();

  // Search state
  const [search, setSearch] = useState<SearchState>({
    keyword: '',
    city: '',
    stateCode: '',
    segmentName: '',
    startDate: '',
    endDate: '',
  });
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState('');

  // Results state
  const [events, setEvents] = useState<DiscoveryEvent[]>([]);
  const [totalElements, setTotalElements] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);

  // Track which events already exist in our DB
  const [existingIds, setExistingIds] = useState<Set<string>>(new Set());

  // Track add-to-scraper status per event
  const [addedEvents, setAddedEvents] = useState<AddedEventState>({});

  // Add-to-scraper modal
  const [modalEvent, setModalEvent] = useState<DiscoveryEvent | null>(null);
  const [modalMappingId, setModalMappingId] = useState('');
  const [modalPriceIncrease, setModalPriceIncrease] = useState('25');

  // Has the user searched at least once?
  const hasSearched = useRef(false);

  // -----------------------------------------------------------------------
  // Search handler
  // -----------------------------------------------------------------------

  const doSearch = useCallback(async (page = 0) => {
    if (!search.keyword.trim() && !search.city.trim()) {
      setSearchError('Enter a keyword or city to search');
      return;
    }

    setIsSearching(true);
    setSearchError('');
    hasSearched.current = true;

    try {
      const params: any = {
        page,
        size: PAGE_SIZE,
        sort: 'date,asc',
      };

      if (search.keyword.trim()) params.keyword = search.keyword.trim();
      if (search.city.trim()) params.city = search.city.trim();
      if (search.stateCode.trim()) params.stateCode = search.stateCode.trim().toUpperCase();
      if (search.segmentName) params.segmentName = search.segmentName;

      if (search.startDate) {
        params.startDateTime = new Date(search.startDate + 'T00:00:00').toISOString().replace('.000Z', 'Z');
      }
      if (search.endDate) {
        params.endDateTime = new Date(search.endDate + 'T23:59:59').toISOString().replace('.000Z', 'Z');
      }

      const result = await searchDiscoveryEvents(params);

      if (result.error) {
        setSearchError(result.error);
        setEvents([]);
        return;
      }

      if (result.data) {
        setEvents(result.data.events);
        setTotalElements(result.data.totalElements);
        setTotalPages(result.data.totalPages);
        setCurrentPage(result.data.page);

        // Check which events already exist in our DB
        const tmIds = result.data.events.map((e) => e.id);
        if (tmIds.length > 0) {
          const { existing } = await checkExistingEvents(tmIds);
          setExistingIds(new Set(existing));
        }
      }
    } catch (err) {
      setSearchError((err as Error).message || 'Search failed');
    } finally {
      setIsSearching(false);
    }
  }, [search]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    doSearch(0);
  };

  // -----------------------------------------------------------------------
  // Add to scraper
  // -----------------------------------------------------------------------

  const openAddModal = (event: DiscoveryEvent) => {
    setModalEvent(event);
    setModalMappingId('');
    setModalPriceIncrease('25');
  };

  const closeAddModal = () => {
    setModalEvent(null);
  };

  const handleAddToScraper = async () => {
    if (!modalEvent) return;
    if (!modalMappingId.trim()) return;

    const eventId = modalEvent.id;
    setAddedEvents((prev) => ({ ...prev, [eventId]: { status: 'adding' } }));
    closeAddModal();

    try {
      // Build the Ticketmaster URL
      const tmUrl = modalEvent.url || `https://www.ticketmaster.com/event/${eventId}`;

      // Build the event datetime
      let eventDateTime = '';
      if (modalEvent.dates.localDate) {
        eventDateTime = modalEvent.dates.localDate;
        if (modalEvent.dates.localTime) {
          eventDateTime += 'T' + modalEvent.dates.localTime.substring(0, 5);
        } else {
          eventDateTime += 'T19:00';
        }
      }

      // Calculate in-hand date (1 day before event)
      let inHandDate = '';
      if (modalEvent.dates.localDate) {
        const d = new Date(modalEvent.dates.localDate + 'T00:00:00');
        d.setDate(d.getDate() - 1);
        inHandDate = d.toISOString().slice(0, 10);
      }

      const eventData = {
        URL: tmUrl,
        Event_ID: eventId,
        Event_Name: modalEvent.name,
        Event_DateTime: eventDateTime ? new Date(eventDateTime) : new Date(),
        Venue: modalEvent.venue?.name || '',
        Zone: modalEvent.classifications?.segment || 'none',
        Available_Seats: 0,
        Skip_Scraping: true,
        inHandDate: inHandDate ? new Date(inHandDate) : new Date(),
        mapping_id: modalMappingId.trim(),
        priceIncreasePercentage: parseFloat(modalPriceIncrease) || 25,
      };

      const result = await createEvent(eventData);

      if (result.error) {
        setAddedEvents((prev) => ({
          ...prev,
          [eventId]: { status: 'error', error: result.error },
        }));
        return;
      }

      setAddedEvents((prev) => ({ ...prev, [eventId]: { status: 'added' } }));
      setExistingIds((prev) => new Set([...prev, eventId]));
    } catch (err) {
      setAddedEvents((prev) => ({
        ...prev,
        [eventId]: { status: 'error', error: (err as Error).message },
      }));
    }
  };

  // -----------------------------------------------------------------------
  // Pagination
  // -----------------------------------------------------------------------

  const goToPage = (page: number) => {
    doSearch(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className="space-y-3">
      {/* Header & Search */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3 space-y-3">
        {/* Title bar */}
        <div className="flex items-center justify-between gap-3 pb-2.5 border-b border-gray-100">
          <div className="flex items-baseline gap-2">
            <h1 className="text-lg font-bold text-slate-800">Discover Events</h1>
            {totalElements > 0 && (
              <span className="text-sm text-slate-500">
                <span className="font-semibold text-slate-700" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {totalElements.toLocaleString()}
                </span>
                <span className="text-slate-400"> results</span>
              </span>
            )}
          </div>
          <button
            onClick={() => router.push('/dashboard/list-event')}
            className="px-3 py-1.5 rounded-lg bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors text-sm flex items-center gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Manual Add</span>
          </button>
        </div>

        {/* Search form */}
        <form onSubmit={handleSearchSubmit}>
          <div className="flex flex-col lg:flex-row gap-2">
            {/* Keyword */}
            <div className="flex-1 relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-4 w-4 text-gray-400" />
              </div>
              <input
                type="text"
                className="block w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-[border-color,box-shadow]"
                placeholder="Artist, team, or event name..."
                value={search.keyword}
                onChange={(e) => setSearch((s) => ({ ...s, keyword: e.target.value }))}
              />
            </div>

            {/* City */}
            <div className="relative w-full lg:w-40">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <MapPin className="h-4 w-4 text-gray-400" />
              </div>
              <input
                type="text"
                className="block w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-[border-color,box-shadow]"
                placeholder="City"
                value={search.city}
                onChange={(e) => setSearch((s) => ({ ...s, city: e.target.value }))}
              />
            </div>

            {/* State code */}
            <input
              type="text"
              className="w-full lg:w-20 px-2.5 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-[border-color,box-shadow] uppercase"
              placeholder="State"
              maxLength={2}
              value={search.stateCode}
              onChange={(e) => setSearch((s) => ({ ...s, stateCode: e.target.value }))}
            />

            {/* Category */}
            <select
              className="w-full lg:w-44 px-2.5 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white transition-[border-color,box-shadow]"
              value={search.segmentName}
              onChange={(e) => setSearch((s) => ({ ...s, segmentName: e.target.value }))}
            >
              {SEGMENTS.map((seg) => (
                <option key={seg.value} value={seg.value}>
                  {seg.label}
                </option>
              ))}
            </select>

            {/* Search button */}
            <button
              type="submit"
              disabled={isSearching}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 transition-[background-color,opacity] flex items-center gap-1.5 text-sm shrink-0"
            >
              {isSearching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              Search
            </button>
          </div>

          {/* Date range row */}
          <div className="flex flex-col sm:flex-row gap-2 mt-2">
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">
                <Calendar className="inline h-3.5 w-3.5 mr-1" />
                From
              </label>
              <input
                type="date"
                className="px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                value={search.startDate}
                onChange={(e) => setSearch((s) => ({ ...s, startDate: e.target.value }))}
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">
                To
              </label>
              <input
                type="date"
                className="px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                value={search.endDate}
                onChange={(e) => setSearch((s) => ({ ...s, endDate: e.target.value }))}
              />
            </div>
          </div>
        </form>
      </div>

      {/* Error message */}
      {searchError && (
        <div className="bg-red-50 border border-red-200 text-red-800 p-4 rounded-lg">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <span>{searchError}</span>
          </div>
        </div>
      )}

      {/* Empty state */}
      {hasSearched.current && !isSearching && events.length === 0 && !searchError && (
        <div className="bg-white rounded-xl border border-gray-200 p-16 text-center">
          <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Search className="w-10 h-10 text-gray-400" />
          </div>
          <h3 className="text-lg font-semibold text-gray-700 mb-2">No events found</h3>
          <p className="text-gray-500 max-w-md mx-auto">
            Try a different keyword, city, or date range.
          </p>
        </div>
      )}

      {/* Loading state */}
      {isSearching && (
        <div className="bg-white rounded-xl border border-gray-200 p-16 text-center">
          <Loader2 className="w-10 h-10 text-blue-500 animate-spin mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-700">Searching Ticketmaster...</h3>
        </div>
      )}

      {/* Results table */}
      {!isSearching && events.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full divide-y divide-gray-200 table-fixed">
              <colgroup>
                <col />
                <col className="w-[160px]" />
                <col className="w-[120px]" />
                <col className="w-[90px]" />
                <col className="w-[120px]" />
                <col className="w-[130px]" />
              </colgroup>
              <thead className="bg-gradient-to-r from-gray-50 to-gray-100">
                <tr>
                  <th className="px-3 py-2.5 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">
                    Event
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">
                    Venue
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">
                    Date
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-3 py-2.5 text-right text-xs font-bold text-gray-600 uppercase tracking-wider">
                    Price Range
                  </th>
                  <th className="px-3 py-2.5 text-right text-xs font-bold text-gray-600 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {events.map((event) => {
                  const isExisting = existingIds.has(event.id);
                  const addState = addedEvents[event.id];

                  return (
                    <tr
                      key={event.id}
                      className={`hover:bg-gray-50 transition-[background-color] duration-150 ${
                        isExisting ? 'bg-green-50/40' : ''
                      }`}
                    >
                      {/* Event name + category */}
                      <td className="px-3 py-2">
                        <div className="min-w-0">
                          <div className="text-gray-900 font-semibold text-sm truncate">
                            {event.name}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
                            {event.classifications?.segment && (
                              <span className="flex items-center gap-0.5">
                                <Tag size={10} />
                                {event.classifications.segment}
                              </span>
                            )}
                            {event.classifications?.genre && (
                              <span className="text-gray-400">{event.classifications.genre}</span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Venue */}
                      <td className="px-3 py-2">
                        {event.venue ? (
                          <div className="min-w-0">
                            <div className="text-sm text-gray-900 truncate">{event.venue.name}</div>
                            <div className="text-xs text-gray-500 truncate">
                              {[event.venue.city, event.venue.state].filter(Boolean).join(', ')}
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </td>

                      {/* Date */}
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div className="font-medium text-gray-900 text-xs tabular-nums">
                          {formatDate(event.dates.localDate)}
                        </div>
                        <div className="text-[11px] text-gray-500 tabular-nums">
                          {formatTime(event.dates.localTime)}
                        </div>
                      </td>

                      {/* Status */}
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${statusBadge(
                            event.dates.statusCode
                          )}`}
                        >
                          {event.dates.statusCode}
                        </span>
                      </td>

                      {/* Price range */}
                      <td className="px-3 py-2 whitespace-nowrap text-right">
                        {event.priceRanges ? (
                          <div className="text-xs tabular-nums">
                            <span className="text-gray-500">$</span>
                            <span className="font-semibold text-gray-900">{event.priceRanges.min.toFixed(0)}</span>
                            <span className="text-gray-400 mx-0.5">–</span>
                            <span className="text-gray-500">$</span>
                            <span className="font-semibold text-gray-900">{event.priceRanges.max.toFixed(0)}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="px-3 py-2 whitespace-nowrap text-right">
                        <div className="flex items-center gap-1.5 justify-end">
                          {/* TM link */}
                          {event.url && (
                            <a
                              href={event.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                              title="View on Ticketmaster"
                            >
                              <ExternalLink size={14} />
                            </a>
                          )}

                          {/* Add button */}
                          {isExisting ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-green-50 text-green-700 border border-green-200">
                              <Check size={12} />
                              Added
                            </span>
                          ) : addState?.status === 'adding' ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                              <Loader2 size={12} className="animate-spin" />
                              Adding...
                            </span>
                          ) : addState?.status === 'added' ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-green-50 text-green-700 border border-green-200">
                              <Check size={12} />
                              Added
                            </span>
                          ) : addState?.status === 'error' ? (
                            <button
                              onClick={() => openAddModal(event)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 transition-colors"
                              title={addState.error}
                            >
                              <AlertCircle size={12} />
                              Retry
                            </button>
                          ) : (
                            <button
                              onClick={() => openAddModal(event)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                            >
                              <Plus size={12} />
                              Add
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile card layout */}
          <div className="md:hidden divide-y divide-gray-200">
            {events.map((event) => {
              const isExisting = existingIds.has(event.id);
              const addState = addedEvents[event.id];

              return (
                <div key={event.id} className={`p-4 ${isExisting ? 'bg-green-50/40' : ''}`}>
                  <div className="space-y-3">
                    {/* Header */}
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="text-gray-900 font-semibold text-base truncate">
                          {event.name}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${statusBadge(event.dates.statusCode)}`}>
                            {event.dates.statusCode}
                          </span>
                          {event.classifications?.segment && (
                            <span className="text-xs text-gray-500">{event.classifications.segment}</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Details */}
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Calendar size={14} className="text-gray-400" />
                          <div>
                            <div className="font-medium text-gray-900">{formatDate(event.dates.localDate)}</div>
                            <div className="text-xs text-gray-500">{formatTime(event.dates.localTime)}</div>
                          </div>
                        </div>
                        {event.venue && (
                          <div className="flex items-center gap-2">
                            <MapPin size={14} className="text-gray-400" />
                            <span className="text-gray-700 truncate">{event.venue.name}</span>
                          </div>
                        )}
                      </div>
                      <div className="space-y-2 text-right">
                        {event.priceRanges && (
                          <div className="flex items-center justify-end gap-1">
                            <DollarSign size={14} className="text-gray-400" />
                            <span className="text-sm font-medium">
                              ${event.priceRanges.min.toFixed(0)} – ${event.priceRanges.max.toFixed(0)}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center justify-between pt-2 border-t border-gray-200">
                      {event.url && (
                        <a
                          href={event.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
                        >
                          <ExternalLink size={12} />
                          Ticketmaster
                        </a>
                      )}
                      {isExisting || addState?.status === 'added' ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-green-50 text-green-700 border border-green-200">
                          <Check size={12} />
                          Added
                        </span>
                      ) : (
                        <button
                          onClick={() => openAddModal(event)}
                          disabled={addState?.status === 'adding'}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 transition-colors"
                        >
                          {addState?.status === 'adding' ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <Plus size={12} />
                          )}
                          Add to Scraper
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Pagination */}
      {!isSearching && totalPages > 1 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 px-4 py-3">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="text-xs text-gray-500">
              Page{' '}
              <span className="font-semibold text-gray-700">{currentPage + 1}</span> of{' '}
              <span className="font-semibold text-gray-700">{totalPages}</span>
              {' '}&middot;{' '}
              <span className="font-semibold text-gray-700">{totalElements.toLocaleString()}</span> total events
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => goToPage(currentPage - 1)}
                disabled={currentPage === 0}
                className="p-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft size={16} />
              </button>

              {/* Page numbers */}
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum: number;
                if (totalPages <= 5) {
                  pageNum = i;
                } else if (currentPage < 3) {
                  pageNum = i;
                } else if (currentPage > totalPages - 4) {
                  pageNum = totalPages - 5 + i;
                } else {
                  pageNum = currentPage - 2 + i;
                }
                return (
                  <button
                    key={pageNum}
                    onClick={() => goToPage(pageNum)}
                    className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${
                      pageNum === currentPage
                        ? 'bg-blue-600 text-white'
                        : 'border border-gray-300 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {pageNum + 1}
                  </button>
                );
              })}

              <button
                onClick={() => goToPage(currentPage + 1)}
                disabled={currentPage >= totalPages - 1}
                className="p-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add-to-Scraper Modal */}
      {modalEvent && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={closeAddModal} />

          {/* Panel */}
          <div className="relative bg-white rounded-2xl shadow-2xl ring-1 ring-black/10 w-full max-w-lg mx-4 overflow-hidden">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-800">Add to Scraper</h2>
              <button
                onClick={closeAddModal}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div className="px-6 py-5 space-y-4">
              {/* Event summary */}
              <div className="bg-gray-50 rounded-lg p-3 space-y-1">
                <div className="font-semibold text-gray-900 text-sm">{modalEvent.name}</div>
                <div className="text-xs text-gray-500 flex items-center gap-3 flex-wrap">
                  {modalEvent.venue && (
                    <span className="flex items-center gap-1">
                      <MapPin size={11} />
                      {modalEvent.venue.name}
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <Calendar size={11} />
                    {formatDate(modalEvent.dates.localDate)} {formatTime(modalEvent.dates.localTime)}
                  </span>
                </div>
                {modalEvent.priceRanges && (
                  <div className="text-xs text-gray-500">
                    TM Price: ${modalEvent.priceRanges.min.toFixed(0)} – ${modalEvent.priceRanges.max.toFixed(0)}
                  </div>
                )}
              </div>

              {/* Mapping ID (required) */}
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">
                  Mapping ID <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-[border-color,box-shadow]"
                  placeholder="Unique mapping ID for this event"
                  value={modalMappingId}
                  onChange={(e) => setModalMappingId(e.target.value)}
                  autoFocus
                />
                <p className="text-[11px] text-gray-400">Required — used to sync with external inventory system</p>
              </div>

              {/* Price increase */}
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">
                  Price Markup %
                </label>
                <input
                  type="number"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-[border-color,box-shadow]"
                  value={modalPriceIncrease}
                  onChange={(e) => setModalPriceIncrease(e.target.value)}
                />
              </div>

              {/* Info note */}
              <p className="text-xs text-gray-500">
                The event will be created with scraping <span className="font-semibold">paused</span>. You can
                enable it from the Events page after verifying the details.
              </p>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-end gap-2">
              <button
                onClick={closeAddModal}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAddToScraper}
                disabled={!modalMappingId.trim()}
                className="px-5 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
              >
                Add Event
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
