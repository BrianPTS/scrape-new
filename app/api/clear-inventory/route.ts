import { NextResponse } from 'next/server';
import { clearInventoryFromStubHub } from '../../../actions/csvActions';

export async function POST() {
  try {
    console.log('Starting inventory clear process on StubHub...');

    const result = await clearInventoryFromStubHub();

    if (result.success) {
      console.log('Inventory cleared successfully');
      return NextResponse.json({
        success: true,
        message: result.message,
        result: result.result,
      });
    } else {
      console.error('Failed to clear inventory:', result.message);
      return NextResponse.json({
        success: false,
        message: result.message
      }, { status: 500 });
    }
  } catch (error) {
    console.error('Error in clear inventory API:', error);
    return NextResponse.json({
      success: false,
      message: `Internal server error: ${error instanceof Error ? error.message : 'Unknown error'}`
    }, { status: 500 });
  }
}
