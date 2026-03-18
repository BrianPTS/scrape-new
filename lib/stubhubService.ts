/**
 * StubHub POS API Service
 * Replaces the Automatiq SyncService with direct StubHub API integration.
 *
 * API Reference: https://developer.stubhub.com/api-reference/inventory/
 * Base URL: https://api.stubhub.net
 * Auth: OAuth2 Bearer token (User-Login flow with write:sellerlistings scope)
 *
 * Key design:
 *  - Uses `external_id` on every listing (set to our inventory_id) so that
 *    re-creating a listing with the same external_id automatically replaces the old one.
 *  - Concurrency-limited batch processing to stay within rate limits.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StubHubConfig {
  /** OAuth2 access token with write:sellerlistings scope */
  accessToken: string;
  /** OAuth2 refresh token (optional – used for automatic token refresh) */
  refreshToken?: string;
  /** OAuth2 client ID (needed for token refresh) */
  clientId?: string;
  /** OAuth2 client secret (needed for token refresh) */
  clientSecret?: string;
  /** Base API URL – defaults to production */
  baseUrl?: string;
  /** Request timeout in ms */
  requestTimeout?: number;
  /** Max retries per request */
  maxRetries?: number;
  /** Max concurrent API calls */
  concurrency?: number;
}

export interface StubHubSeating {
  section: string;
  row: string;
  seat_from?: string;
  seat_to?: string;
  hide_seat_details?: boolean;
}

export interface StubHubMoney {
  amount: number;
  currency_code: string;
}

export interface StubHubEventInfo {
  name: string;
  start_date: string; // ISO 8601
  venue?: {
    name: string;
    city?: string;
    country?: string;
  };
}

export interface StubHubListingPayload {
  external_id: string;
  number_of_tickets: number;
  display_number_of_tickets?: number;
  seating: StubHubSeating;
  ticket_price: StubHubMoney;
  face_value?: StubHubMoney;
  ticket_type?: string;
  split_type?: string;
  in_hand_at?: string;
  notes?: string;
  listing_note_ids?: number[];
  instant_delivery?: boolean;
  /** Event info for the "create for requested event" endpoint */
  event?: StubHubEventInfo;
}

export interface StubHubListingResponse {
  id?: number;
  external_id?: string;
  status?: string;
  _links?: Record<string, { href: string }>;
  [key: string]: unknown;
}

export interface StubHubBatchResult {
  total: number;
  created: number;
  updated: number;
  failed: number;
  deleted: number;
  errors: Array<{ externalId: string; error: string }>;
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

/**
 * Map our internal stock_type to StubHub ticket_type.
 */
export function mapTicketType(stockType?: string): string {
  switch (stockType) {
    case 'ELECTRONIC':
      return 'ETicket';
    case 'HARD':
      return 'PaperTicket';
    case 'MOBILE_TRANSFER':
      return 'ETicket';
    case 'MOBILE_SCREENCAP':
      return 'ETicket';
    case 'PAPERLESS':
      return 'ETicket';
    case 'PAPERLESS_CARD':
      return 'ETicket';
    case 'FLASH':
      return 'ETicket';
    default:
      return 'ETicket';
  }
}

/**
 * Map our internal split_type + custom_split to StubHub split_type.
 *
 * StubHub values: "Any", "None", "AvoidOne", "AvoidOneAndThree"
 * Our values:     "CUSTOM", "DEFAULT", "NEVERLEAVEONE", "ANY"
 */
export function mapSplitType(splitType?: string): string {
  switch (splitType) {
    case 'ANY':
      return 'Any';
    case 'NEVERLEAVEONE':
      return 'AvoidOne';
    case 'CUSTOM':
      // StubHub doesn't have an exact "custom" equivalent –
      // AvoidOne is the closest safe default.
      return 'AvoidOne';
    case 'DEFAULT':
      return 'AvoidOne';
    default:
      return 'AvoidOne';
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

class StubHubService {
  private accessToken: string;
  private refreshToken?: string;
  private clientId?: string;
  private clientSecret?: string;
  private baseUrl: string;
  private requestTimeout: number;
  private maxRetries: number;
  private concurrency: number;

  constructor(config: StubHubConfig) {
    this.accessToken = config.accessToken;
    this.refreshToken = config.refreshToken;
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.baseUrl = config.baseUrl || 'https://api.stubhub.net';
    this.requestTimeout = config.requestTimeout || 30000;
    this.maxRetries = config.maxRetries || 3;
    this.concurrency = config.concurrency || 5;
  }

  // -----------------------------------------------------------------------
  // Low-level HTTP
  // -----------------------------------------------------------------------

  private async fetchWithTimeout(
    url: string,
    options: RequestInit = {},
    timeout = this.requestTimeout
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/hal+json',
          ...options.headers,
        },
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error: unknown) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeout}ms`);
      }
      throw error;
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    let lastError: Error = new Error('Unknown error');

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const url = `${this.baseUrl}${path}`;
        const options: RequestInit = { method };
        if (body) {
          options.body = JSON.stringify(body);
        }

        const response = await this.fetchWithTimeout(url, options);

        // Handle 401 – try refreshing the token once
        if (response.status === 401 && attempt === 0 && this.refreshToken) {
          const refreshed = await this.tryRefreshToken();
          if (refreshed) continue; // retry with new token
        }

        if (response.status === 204) {
          return {} as T; // No content (delete responses)
        }

        const text = await response.text();

        if (!response.ok) {
          throw new Error(
            `HTTP ${response.status}: ${text || response.statusText}`
          );
        }

        return text ? JSON.parse(text) : ({} as T);
      } catch (error) {
        lastError = error as Error;
        console.error(
          `StubHub API ${method} ${path} attempt ${attempt + 1}/${this.maxRetries} failed:`,
          lastError.message
        );

        if (attempt < this.maxRetries - 1) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError;
  }

  // -----------------------------------------------------------------------
  // Token refresh
  // -----------------------------------------------------------------------

  private async tryRefreshToken(): Promise<boolean> {
    if (!this.refreshToken || !this.clientId || !this.clientSecret) {
      return false;
    }

    try {
      const tokenUrl = 'https://account.stubhub.com/oauth2/token';
      const basicAuth = Buffer.from(
        `${this.clientId}:${this.clientSecret}`
      ).toString('base64');

      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: this.refreshToken,
          scope: 'read:sellerlistings write:sellerlistings',
        }),
      });

      if (!response.ok) return false;

      const data = await response.json();
      this.accessToken = data.access_token;
      if (data.refresh_token) {
        this.refreshToken = data.refresh_token;
      }

      console.log('StubHub access token refreshed successfully');
      return true;
    } catch (error) {
      console.error('Failed to refresh StubHub token:', error);
      return false;
    }
  }

  // -----------------------------------------------------------------------
  // Concurrency helper
  // -----------------------------------------------------------------------

  private async runWithConcurrency<T, R>(
    items: T[],
    fn: (item: T) => Promise<R>
  ): Promise<Array<{ item: T; result?: R; error?: string }>> {
    const results: Array<{ item: T; result?: R; error?: string }> = [];
    let index = 0;

    const worker = async () => {
      while (index < items.length) {
        const i = index++;
        const item = items[i];
        try {
          const result = await fn(item);
          results[i] = { item, result };
        } catch (error) {
          results[i] = {
            item,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }
    };

    const workers = Array.from(
      { length: Math.min(this.concurrency, items.length) },
      () => worker()
    );
    await Promise.all(workers);

    return results;
  }

  // -----------------------------------------------------------------------
  // Public API – Single listing operations
  // -----------------------------------------------------------------------

  /**
   * Create a seller listing for a requested event.
   * Uses the "create for requested event" endpoint which accepts event text
   * info and auto-maps to StubHub events.
   */
  async createListing(
    payload: StubHubListingPayload
  ): Promise<StubHubListingResponse> {
    return this.request<StubHubListingResponse>(
      'POST',
      '/inventory/sellerlistings',
      payload
    );
  }

  /**
   * Update a seller listing by its external ID.
   */
  async updateListingByExternalId(
    externalId: string,
    payload: Partial<StubHubListingPayload>
  ): Promise<StubHubListingResponse> {
    return this.request<StubHubListingResponse>(
      'PATCH',
      `/inventory/sellerlistings/external/${encodeURIComponent(externalId)}`,
      payload
    );
  }

  /**
   * Delete a seller listing by its external ID.
   */
  async deleteListingByExternalId(externalId: string): Promise<void> {
    await this.request<void>(
      'DELETE',
      `/inventory/sellerlistings/external/${encodeURIComponent(externalId)}`
    );
  }

  /**
   * Delete a seller listing by its StubHub listing ID.
   */
  async deleteListingById(listingId: number): Promise<void> {
    await this.request<void>(
      'DELETE',
      `/inventory/sellerlistings/${listingId}`
    );
  }

  /**
   * Get a seller listing by its external ID.
   */
  async getListingByExternalId(
    externalId: string
  ): Promise<StubHubListingResponse | null> {
    try {
      return await this.request<StubHubListingResponse>(
        'GET',
        `/inventory/sellerlistings/external/${encodeURIComponent(externalId)}`
      );
    } catch {
      return null; // 404 or other error – listing doesn't exist
    }
  }

  /**
   * List all seller listings with pagination.
   */
  async listSellerListings(
    page = 1,
    pageSize = 100
  ): Promise<{
    items: StubHubListingResponse[];
    total_items?: number;
    page?: number;
    page_size?: number;
  }> {
    const result = await this.request<{
      items?: StubHubListingResponse[];
      _embedded?: { items?: StubHubListingResponse[] };
      total_items?: number;
      page?: number;
      page_size?: number;
    }>(
      'GET',
      `/inventory/sellerlistings?page=${page}&page_size=${pageSize}`
    );

    return {
      items: result._embedded?.items || result.items || [],
      total_items: result.total_items,
      page: result.page,
      page_size: result.page_size,
    };
  }

  // -----------------------------------------------------------------------
  // Public API – Batch operations
  // -----------------------------------------------------------------------

  /**
   * Upsert listings in batch.
   *
   * Because StubHub's create endpoint replaces any listing with the same
   * external_id, we simply POST every listing — this handles both creates
   * and updates in one pass.
   */
  async upsertListings(
    listings: StubHubListingPayload[]
  ): Promise<StubHubBatchResult> {
    const result: StubHubBatchResult = {
      total: listings.length,
      created: 0,
      updated: 0,
      failed: 0,
      deleted: 0,
      errors: [],
    };

    if (listings.length === 0) return result;

    console.log(
      `Upserting ${listings.length} listings to StubHub (concurrency: ${this.concurrency})...`
    );

    const outcomes = await this.runWithConcurrency(listings, async (listing) => {
      return this.createListing(listing);
    });

    for (const outcome of outcomes) {
      if (outcome.error) {
        result.failed++;
        result.errors.push({
          externalId: outcome.item.external_id,
          error: outcome.error,
        });
      } else {
        // StubHub replaces on duplicate external_id, so we count all
        // successes as created (the API handles the upsert internally).
        result.created++;
      }
    }

    console.log(
      `StubHub upsert complete: ${result.created} succeeded, ${result.failed} failed`
    );
    return result;
  }

  /**
   * Delete listings by their external IDs in batch.
   */
  async deleteListingsByExternalIds(
    externalIds: string[]
  ): Promise<StubHubBatchResult> {
    const result: StubHubBatchResult = {
      total: externalIds.length,
      created: 0,
      updated: 0,
      failed: 0,
      deleted: 0,
      errors: [],
    };

    if (externalIds.length === 0) return result;

    console.log(
      `Deleting ${externalIds.length} listings from StubHub...`
    );

    const outcomes = await this.runWithConcurrency(
      externalIds,
      async (externalId) => {
        await this.deleteListingByExternalId(externalId);
        return { deleted: true };
      }
    );

    for (const outcome of outcomes) {
      if (outcome.error) {
        result.failed++;
        result.errors.push({
          externalId: outcome.item,
          error: outcome.error,
        });
      } else {
        result.deleted++;
      }
    }

    console.log(
      `StubHub delete complete: ${result.deleted} deleted, ${result.failed} failed`
    );
    return result;
  }

  /**
   * Clear ALL seller listings by paginating through and deleting each one.
   */
  async clearAllListings(): Promise<StubHubBatchResult> {
    const result: StubHubBatchResult = {
      total: 0,
      created: 0,
      updated: 0,
      failed: 0,
      deleted: 0,
      errors: [],
    };

    console.log('Clearing all StubHub listings...');

    let page = 1;
    const pageSize = 100;
    let hasMore = true;

    while (hasMore) {
      const listingsPage = await this.listSellerListings(page, pageSize);
      const items = listingsPage.items;

      if (items.length === 0) {
        hasMore = false;
        break;
      }

      result.total += items.length;

      // Delete each listing in this page
      const idsToDelete = items
        .filter((item) => item.id)
        .map((item) => item.id as number);

      const outcomes = await this.runWithConcurrency(
        idsToDelete,
        async (id) => {
          await this.deleteListingById(id);
          return { deleted: true };
        }
      );

      for (const outcome of outcomes) {
        if (outcome.error) {
          result.failed++;
          result.errors.push({
            externalId: String(outcome.item),
            error: outcome.error,
          });
        } else {
          result.deleted++;
        }
      }

      console.log(
        `Cleared page ${page}: ${outcomes.length} listings processed`
      );

      // Always re-fetch page 1 since items are being deleted
      // If the total_items indicates there are more, keep going
      if (
        listingsPage.total_items &&
        result.deleted + result.failed < listingsPage.total_items
      ) {
        // Stay on page 1 since deletions shift the remaining items
        page = 1;
      } else {
        hasMore = false;
      }
    }

    console.log(
      `Clear complete: ${result.deleted} deleted, ${result.failed} failed out of ${result.total}`
    );
    return result;
  }
}

export default StubHubService;
