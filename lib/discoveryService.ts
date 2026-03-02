/**
 * Ticketmaster Discovery API Service
 *
 * Provides search and lookup capabilities for Ticketmaster events and venues
 * using the Discovery API v2. This does NOT replace the scraper — it provides
 * event metadata (name, date, venue, price ranges, status) for discovery and
 * auto-fill purposes.
 *
 * API Docs: https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/
 */

const BASE_URL = 'https://app.ticketmaster.com/discovery/v2';
const REQUEST_TIMEOUT = 15000; // 15 seconds

function getApiKey(): string {
  const key = process.env.TM_DISCOVERY_API_KEY;
  if (!key) {
    throw new Error(
      'TM_DISCOVERY_API_KEY is not configured. ' +
      'Get a free key at https://developer.ticketmaster.com/products-and-docs/apis/getting-started/'
    );
  }
  return key;
}

async function fetchWithTimeout(url: string, timeout = REQUEST_TIMEOUT): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Discovery API request timed out after ${timeout}ms`);
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiscoveryEvent {
  id: string;
  name: string;
  url: string;
  locale: string;
  dates: {
    localDate: string;      // "2026-06-15"
    localTime: string;      // "19:30:00"
    timezone: string;       // "America/New_York"
    statusCode: string;     // "onsale" | "offsale" | "cancelled" | "postponed" | "rescheduled"
  };
  venue: {
    id: string;
    name: string;
    city: string;
    state: string;
    country: string;
    address: string;
    postalCode: string;
    timezone: string;
  } | null;
  priceRanges: {
    min: number;
    max: number;
    currency: string;
  } | null;
  classifications: {
    segment: string;        // "Music", "Sports", "Arts & Theatre"
    genre: string;
    subGenre: string;
  } | null;
  images: { url: string; width: number; height: number; ratio: string }[];
  seatmapUrl: string | null;
}

export interface DiscoverySearchParams {
  keyword?: string;
  city?: string;
  stateCode?: string;
  venueId?: string;
  startDateTime?: string;   // ISO 8601 — "2026-06-01T00:00:00Z"
  endDateTime?: string;
  segmentName?: string;     // "Music" | "Sports" | "Arts & Theatre" | "Film" | "Miscellaneous"
  sort?: string;            // "date,asc" | "date,desc" | "name,asc" | "name,desc" | "relevance,asc"
  page?: number;
  size?: number;            // max 200
  countryCode?: string;
}

export interface DiscoverySearchResult {
  events: DiscoveryEvent[];
  totalElements: number;
  totalPages: number;
  page: number;
  size: number;
}

// ---------------------------------------------------------------------------
// Parsers — transform raw API JSON into our clean types
// ---------------------------------------------------------------------------

function parseEvent(raw: any): DiscoveryEvent {
  const venue = raw._embedded?.venues?.[0];
  const classification = raw.classifications?.[0];
  const priceRange = raw.priceRanges?.[0];

  return {
    id: raw.id || '',
    name: raw.name || '',
    url: raw.url || '',
    locale: raw.locale || '',
    dates: {
      localDate: raw.dates?.start?.localDate || '',
      localTime: raw.dates?.start?.localTime || '',
      timezone: raw.dates?.timezone || venue?.timezone || '',
      statusCode: raw.dates?.status?.code || 'unknown',
    },
    venue: venue
      ? {
          id: venue.id || '',
          name: venue.name || '',
          city: venue.city?.name || '',
          state: venue.state?.stateCode || venue.state?.name || '',
          country: venue.country?.countryCode || '',
          address: venue.address?.line1 || '',
          postalCode: venue.postalCode || '',
          timezone: venue.timezone || '',
        }
      : null,
    priceRanges: priceRange
      ? {
          min: priceRange.min ?? 0,
          max: priceRange.max ?? 0,
          currency: priceRange.currency || 'USD',
        }
      : null,
    classifications: classification
      ? {
          segment: classification.segment?.name || '',
          genre: classification.genre?.name || '',
          subGenre: classification.subGenre?.name || '',
        }
      : null,
    images: (raw.images || []).map((img: any) => ({
      url: img.url || '',
      width: img.width || 0,
      height: img.height || 0,
      ratio: img.ratio || '',
    })),
    seatmapUrl: raw.seatmap?.staticUrl || null,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Search for events on Ticketmaster.
 */
export async function searchEvents(params: DiscoverySearchParams): Promise<DiscoverySearchResult> {
  const apiKey = getApiKey();

  const query = new URLSearchParams();
  query.set('apikey', apiKey);
  query.set('locale', '*');

  if (params.keyword) query.set('keyword', params.keyword);
  if (params.city) query.set('city', params.city);
  if (params.stateCode) query.set('stateCode', params.stateCode);
  if (params.venueId) query.set('venueId', params.venueId);
  if (params.startDateTime) query.set('startDateTime', params.startDateTime);
  if (params.endDateTime) query.set('endDateTime', params.endDateTime);
  if (params.segmentName) query.set('segmentName', params.segmentName);
  if (params.countryCode) query.set('countryCode', params.countryCode || 'US');
  query.set('sort', params.sort || 'date,asc');
  query.set('page', String(params.page ?? 0));
  query.set('size', String(Math.min(params.size ?? 20, 200)));

  const url = `${BASE_URL}/events.json?${query.toString()}`;
  const response = await fetchWithTimeout(url);

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Discovery API error ${response.status}: ${text}`);
  }

  const data = await response.json();

  const embedded = data._embedded?.events || [];
  const pageInfo = data.page || {};

  return {
    events: embedded.map(parseEvent),
    totalElements: pageInfo.totalElements ?? 0,
    totalPages: pageInfo.totalPages ?? 0,
    page: pageInfo.number ?? 0,
    size: pageInfo.size ?? 20,
  };
}

/**
 * Get details for a single event by its Ticketmaster Event ID.
 */
export async function getEventDetails(eventId: string): Promise<DiscoveryEvent | null> {
  const apiKey = getApiKey();

  const url = `${BASE_URL}/events/${encodeURIComponent(eventId)}.json?apikey=${apiKey}&locale=*`;
  const response = await fetchWithTimeout(url);

  if (response.status === 404) return null;

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Discovery API error ${response.status}: ${text}`);
  }

  const data = await response.json();
  return parseEvent(data);
}
