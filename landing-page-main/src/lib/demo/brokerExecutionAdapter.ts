type TreasuryExecutionInput = {
  orderId: string;
  walletAddress: string;
  gldAmount: string;
  treasuryProduct: string;
  burnTransactionHash: string;
};

type IbkrOrderResponse = {
  order_id?: string;
  order_status?: string;
  id?: string;
  message?: string;
};

const GLD_USD_REFERENCE_PRICE = 100;

function estimateTreasuryNotional(gldAmount: string) {
  const estimatedUsdProceeds = Number(gldAmount) * GLD_USD_REFERENCE_PRICE;

  return Number.isFinite(estimatedUsdProceeds)
    ? `$${estimatedUsdProceeds.toLocaleString(undefined, {
        maximumFractionDigits: 2,
      })} notional`
    : "Manual quote required";
}

function buildReadinessResult(input: TreasuryExecutionInput) {
  return {
    ...input,
    status: "Broker execution package prepared",
    executionVenue: "Treasury execution adapter",
    estimatedTreasuryAmount: estimateTreasuryNotional(input.gldAmount),
    brokerOrderId: null,
    brokerOrderStatus: "Pending configured brokerage session",
    regulatoryNotes: [
      "Requires brokerage account authorization and documented client instruction before live order routing.",
      "Requires KYC/AML, suitability or best-interest review, custody controls, and books-and-records retention before production use.",
      "Uses a server-side broker adapter boundary so browser code never receives broker credentials.",
    ],
    createdAt: new Date().toISOString(),
  };
}

async function submitInteractiveBrokersOrder(input: TreasuryExecutionInput) {
  const accountId = process.env.IBKR_ACCOUNT_ID;
  const treasuryConid = process.env.IBKR_TREASURY_CONID;
  const accessToken = process.env.IBKR_ACCESS_TOKEN;
  const baseUrl = process.env.IBKR_BASE_URL ?? "https://api.ibkr.com/v1/api";
  const enableOrderSubmission = process.env.IBKR_ENABLE_ORDER_SUBMISSION === "true";
  const limitPrice = process.env.IBKR_LIMIT_PRICE;

  if (!enableOrderSubmission || !accountId || !treasuryConid || !accessToken) {
    return buildReadinessResult(input);
  }

  const response = await fetch(`${baseUrl}/iserver/account/${accountId}/orders`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify([
      {
        conid: Number(treasuryConid),
        orderType: process.env.IBKR_ORDER_TYPE ?? "MKT",
        ...(limitPrice ? { price: Number(limitPrice) } : {}),
        side: "BUY",
        tif: process.env.IBKR_TIME_IN_FORCE ?? "DAY",
        quantity: Number(process.env.IBKR_TREASURY_QUANTITY ?? "1"),
      },
    ]),
  });

  const brokerResponse = (await response.json()) as IbkrOrderResponse | IbkrOrderResponse[];

  if (!response.ok) {
    throw new Error(`Interactive Brokers order request failed with HTTP ${response.status}.`);
  }

  const firstResponse = Array.isArray(brokerResponse) ? brokerResponse[0] : brokerResponse;

  return {
    ...buildReadinessResult(input),
    status: "Broker order submitted",
    executionVenue: "Interactive Brokers Web API",
    brokerOrderId: firstResponse?.order_id ?? firstResponse?.id ?? null,
    brokerOrderStatus: firstResponse?.order_status ?? firstResponse?.message ?? "Submitted",
  };
}

export async function createTreasuryExecutionOrder(input: TreasuryExecutionInput) {
  if (process.env.TREASURY_EXECUTION_ADAPTER === "ibkr") {
    return submitInteractiveBrokersOrder(input);
  }

  return buildReadinessResult(input);
}
