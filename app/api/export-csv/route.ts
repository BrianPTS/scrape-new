import { NextRequest, NextResponse } from 'next/server';
import { generateInventoryCsv, uploadInventoryToStubHub } from '../../../actions/csvActions';

// Set maxDuration for this API route to handle large inventory operations
export const maxDuration = 300; // 5 minutes

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { eventUpdateFilterMinutes = 0 } = body;

    console.log('Starting manual inventory generation and StubHub upload...');

    // Generate inventory data
    const generateResult = await generateInventoryCsv(eventUpdateFilterMinutes);

    if (!generateResult.success || !generateResult.records || generateResult.records.length === 0) {
      console.error('Inventory generation failed:', generateResult.message);
      return NextResponse.json({
        success: false,
        message: generateResult.message || 'Failed to generate inventory data'
      }, { status: 400 });
    }

    console.log(`Inventory generated successfully: ${generateResult.recordCount} records`);

    // Upload inventory directly to StubHub
    const uploadResult = await uploadInventoryToStubHub(generateResult.records);

    if (uploadResult.success) {
      console.log('Inventory uploaded to StubHub successfully');
      return NextResponse.json({
        success: true,
        message: 'Inventory generated and uploaded to StubHub successfully',
        recordCount: generateResult.recordCount,
        generationTime: generateResult.generationTime,
        stubhubResult: uploadResult.result,
      });
    } else {
      console.error('StubHub upload failed:', uploadResult.message);
      return NextResponse.json({
        success: false,
        message: `Inventory generation succeeded but StubHub upload failed: ${uploadResult.message}`,
        recordCount: generateResult.recordCount,
        generationTime: generateResult.generationTime
      }, { status: 500 });
    }
  } catch (error) {
    console.error('Error in export inventory API:', error);
    return NextResponse.json({
      success: false,
      message: 'Internal server error during inventory export'
    }, { status: 500 });
  }
}
