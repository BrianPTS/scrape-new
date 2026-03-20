import { NextResponse } from 'next/server';
import dbConnect from '@/lib/dbConnect';
import { SaleSnapshot } from '@/models/saleModel';

export async function GET(request: Request) {
  try {
    await dbConnect();

    const { searchParams } = new URL(request.url);
    const eventId = searchParams.get('eventId');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '100');
    const skip = (page - 1) * limit;

    // Build filter
    interface SaleFilter {
      eventId?: string;
    }
    const filter: SaleFilter = {};
    if (eventId) filter.eventId = eventId;

    const [sales, total] = await Promise.all([
      SaleSnapshot.find(filter)
        .sort({ saleCreatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      SaleSnapshot.countDocuments(filter),
    ]);

    // ── Aggregate: sales by availability % bucket ──
    const bucketPipeline: object[] = [
      ...(eventId ? [{ $match: { eventId } }] : []),
      {
        $bucket: {
          groupBy: '$snapshot.eventAvailabilityPct',
          boundaries: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, Infinity],
          default: 'unknown',
          output: {
            count: { $sum: 1 },
            totalTickets: { $sum: '$quantity' },
            avgPrice: { $avg: '$pricePerTicket' },
            totalRevenue: { $sum: '$totalProceeds' },
            events: { $addToSet: '$eventName' },
          },
        },
      },
      { $sort: { _id: 1 } },
    ];

    const buckets = await SaleSnapshot.aggregate(bucketPipeline);

    // ── Aggregate: per-event summary ──
    const eventSummaryPipeline: object[] = [
      ...(eventId ? [{ $match: { eventId } }] : []),
      {
        $group: {
          _id: '$eventId',
          eventName: { $first: '$eventName' },
          venue: { $first: '$venue' },
          eventDateTime: { $first: '$eventDateTime' },
          totalSales: { $sum: 1 },
          totalTickets: { $sum: '$quantity' },
          totalRevenue: { $sum: '$totalProceeds' },
          avgAvailabilityPct: { $avg: '$snapshot.eventAvailabilityPct' },
          minAvailabilityPct: { $min: '$snapshot.eventAvailabilityPct' },
          maxAvailabilityPct: { $max: '$snapshot.eventAvailabilityPct' },
          sections: { $addToSet: '$section' },
        },
      },
      { $sort: { totalRevenue: -1 } },
      { $limit: 50 },
    ];

    const eventSummaries = await SaleSnapshot.aggregate(eventSummaryPipeline);

    return NextResponse.json({
      sales,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      analytics: {
        buckets,
        eventSummaries,
      },
    });
  } catch (error) {
    console.error('Sales API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch sales data' },
      { status: 500 }
    );
  }
}
