'use server';

/**
 * Discovery Actions — Server actions for Ticketmaster Discovery API.
 *
 * These actions wrap the discovery service and are called from client components
 * to search for events and fetch event details from the TM Discovery API.
 */

import { searchEvents, getEventDetails, type DiscoverySearchParams, type DiscoverySearchResult, type DiscoveryEvent } from '@/lib/discoveryService';
import dbConnect from '@/lib/dbConnect';
import { Event } from '@/models/eventModel';

/**
 * Search Ticketmaster events using the Discovery API.
 */
export async function searchDiscoveryEvents(
  params: DiscoverySearchParams
): Promise<{ data?: DiscoverySearchResult; error?: string }> {
  try {
    const data = await searchEvents(params);
    return { data };
  } catch (error: unknown) {
    console.error('Discovery search error:', error);
    return { error: (error as Error).message || 'Failed to search events' };
  }
}

/**
 * Fetch details for a single event from the Discovery API.
 */
export async function fetchDiscoveryEventDetails(
  eventId: string
): Promise<{ data?: DiscoveryEvent; error?: string }> {
  try {
    const data = await getEventDetails(eventId);
    if (!data) {
      return { error: `Event ${eventId} not found on Ticketmaster` };
    }
    return { data };
  } catch (error: unknown) {
    console.error('Discovery event details error:', error);
    return { error: (error as Error).message || 'Failed to fetch event details' };
  }
}

/**
 * Check which TM Event IDs from a list already exist in our database.
 * Returns a Set-like array of Event_IDs that are already tracked.
 */
export async function checkExistingEvents(
  tmEventIds: string[]
): Promise<{ existing: string[]; error?: string }> {
  if (!tmEventIds.length) return { existing: [] };

  try {
    await dbConnect();
    const found = await Event.find(
      { Event_ID: { $in: tmEventIds } },
      { Event_ID: 1 }
    ).lean();
    return { existing: found.map((e: any) => e.Event_ID) };
  } catch (error: unknown) {
    console.error('Check existing events error:', error);
    return { existing: [], error: (error as Error).message || 'Failed to check existing events' };
  }
}
