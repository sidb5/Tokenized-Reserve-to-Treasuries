import { createTreasuryExecutionOrder } from "@/lib/demo/brokerExecutionAdapter";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const body = await request.json();

  if (
    !body?.orderId ||
    !body?.walletAddress ||
    !body?.gldAmount ||
    !body?.treasuryProduct ||
    !body?.burnTransactionHash
  ) {
    return NextResponse.json({ error: "Invalid Treasury order" }, { status: 400 });
  }

  return NextResponse.json(
    await createTreasuryExecutionOrder({
      orderId: String(body.orderId),
      walletAddress: String(body.walletAddress),
      gldAmount: String(body.gldAmount),
      treasuryProduct: String(body.treasuryProduct),
      burnTransactionHash: String(body.burnTransactionHash),
    })
  );
}
