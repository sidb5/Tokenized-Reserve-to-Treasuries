"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ethers } from "ethers";
import localDeployment from "@/lib/contracts/localDeployment.json";
import { Button } from "@/components/Button";

type EthereumProvider = ethers.Eip1193Provider & {
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

type TokenKey = "GLD" | "USDC";
type ConnectionMode = "injected" | "local";

type DemoBalances = {
  accountGld: bigint;
  accountUsdc: bigint;
  merchantGld: bigint;
  merchantUsdc: bigint;
};

type TreasuryOrder = {
  orderId: string;
  status: string;
  walletAddress: string;
  gldAmount: string;
  treasuryProduct: string;
  estimatedTreasuryAmount: string;
  burnTransactionHash: string;
  executionVenue: string;
  brokerOrderId: string | null;
  brokerOrderStatus: string;
  regulatoryNotes: string[];
  createdAt: string;
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const DEFAULT_MERCHANT = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

const gldAbi = [
  "function balanceOf(address account) view returns (uint256)",
  "function calculatePaymentTokenForGld(address paymentTokenAddress, uint256 gldAmount, bool useUsdExchangeRate) view returns (uint256)",
  "function swapSupportedTokenForGld(address paymentTokenAddress, uint256 paymentTokenAmount, uint256 minAmountOut, bool useUsdExchangeRate)",
  "function redeemGld(uint256 amount, string purchaseId)",
  "function approve(address spender, uint256 amount) returns (bool)",
] as const;

const usdcAbi = [
  "function balanceOf(address account) view returns (uint256)",
  "function mint(address to, uint256 amount)",
  "function approve(address spender, uint256 amount) returns (bool)",
] as const;

const paymentCoreAbi = [
  "function calculateFee(address token, uint256 amount) view returns (uint256)",
  "function transferWithFeeFrom(address token, address recipient, uint256 amount, bool senderPaysFee) returns (bool)",
] as const;

type Erc20Contract = {
  balanceOf: (account: string) => Promise<bigint>;
  approve: (
    spender: string,
    amount: bigint
  ) => Promise<ethers.ContractTransactionResponse>;
};

type GldContract = Erc20Contract & {
  calculatePaymentTokenForGld: (
    paymentTokenAddress: string,
    gldAmount: bigint,
    useUsdExchangeRate: boolean
  ) => Promise<bigint>;
  swapSupportedTokenForGld: (
    paymentTokenAddress: string,
    paymentTokenAmount: bigint,
    minAmountOut: bigint,
    useUsdExchangeRate: boolean
  ) => Promise<ethers.ContractTransactionResponse>;
  redeemGld: (
    amount: bigint,
    purchaseId: string
  ) => Promise<ethers.ContractTransactionResponse>;
};

type UsdcContract = Erc20Contract & {
  mint: (to: string, amount: bigint) => Promise<ethers.ContractTransactionResponse>;
};

type PaymentCoreContract = {
  calculateFee: (token: string, amount: bigint) => Promise<bigint>;
  transferWithFeeFrom: (
    token: string,
    recipient: string,
    amount: bigint,
    senderPaysFee: boolean
  ) => Promise<ethers.ContractTransactionResponse>;
};

function getGldContract(runner: ethers.ContractRunner | null): GldContract {
  return new ethers.Contract(
    localDeployment.contracts.Gld,
    gldAbi,
    runner
  ) as unknown as GldContract;
}

function getUsdcContract(runner: ethers.ContractRunner | null): UsdcContract {
  return new ethers.Contract(
    localDeployment.contracts.UsdcTest,
    usdcAbi,
    runner
  ) as unknown as UsdcContract;
}

function getPaymentCoreContract(runner: ethers.ContractRunner | null): PaymentCoreContract {
  return new ethers.Contract(
    localDeployment.contracts.PaymentCore,
    paymentCoreAbi,
    runner
  ) as unknown as PaymentCoreContract;
}

function formatToken(value: bigint) {
  return Number(ethers.formatUnits(value, 6)).toLocaleString(undefined, {
    maximumFractionDigits: 6,
  });
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function isAddress(value: string) {
  return ethers.isAddress(value);
}

export function LocalSettlementDemo() {
  const hasAutoConnected = useRef(false);
  const isTransactionInFlight = useRef(false);
  const [account, setAccount] = useState("");
  const [connectionMode, setConnectionMode] = useState<ConnectionMode | null>(null);
  const [walletChainId, setWalletChainId] = useState<number | null>(null);
  const [balances, setBalances] = useState<DemoBalances>({
    accountGld: 0n,
    accountUsdc: 0n,
    merchantGld: 0n,
    merchantUsdc: 0n,
  });
  const [buyAmount, setBuyAmount] = useState("1");
  const [redeemAmount, setRedeemAmount] = useState("5");
  const [paymentAmount, setPaymentAmount] = useState("1");
  const [paymentToken, setPaymentToken] = useState<TokenKey>("GLD");
  const [merchantAddress, setMerchantAddress] = useState(DEFAULT_MERCHANT);
  const [treasuryAmount, setTreasuryAmount] = useState("5");
  const [treasuryProduct, setTreasuryProduct] = useState("13-week Treasury bill");
  const [lastTreasuryOrder, setLastTreasuryOrder] = useState<TreasuryOrder | null>(null);
  const [events, setEvents] = useState<string[]>([]);
  const [status, setStatus] = useState("Run the local demo script, then connect a wallet. If MetaMask is not installed, the page uses a local Hardhat demo wallet.");
  const [isClientReady, setIsClientReady] = useState(false);
  const [clickCount, setClickCount] = useState(0);
  const [isPending, setIsPending] = useState(false);

  const contracts = localDeployment.contracts;
  const isConfigured =
    contracts.Gld !== ZERO_ADDRESS &&
    contracts.UsdcTest !== ZERO_ADDRESS &&
    contracts.PaymentCore !== ZERO_ADDRESS;
  const expectedChainId = localDeployment.chainId;
  const isWrongNetwork = walletChainId !== null && walletChainId !== expectedChainId;

  const deploymentSummary = useMemo(() => {
    if (!isConfigured) {
      return "No local deployment found yet.";
    }

    return [
      `GLD ${shortAddress(contracts.Gld)}`,
      `USDC ${shortAddress(contracts.UsdcTest)}`,
      `PaymentCore ${shortAddress(contracts.PaymentCore)}`,
    ].join(" / ");
  }, [contracts.PaymentCore, contracts.Gld, contracts.UsdcTest, isConfigured]);

  const selectedPaymentTokenAddress = paymentToken === "GLD" ? contracts.Gld : contracts.UsdcTest;

  const appendEvent = useCallback((message: string) => {
    setEvents((current) => [message, ...current].slice(0, 8));
  }, []);

  const markButtonClick = useCallback((label: string) => {
    setClickCount((current) => current + 1);
    setStatus(`${label} clicked. Working...`);
  }, []);

  useEffect(() => {
    setIsClientReady(true);
  }, []);

  const getReadProvider = useCallback(() => {
    if (connectionMode === "local" || !window.ethereum) {
      return new ethers.JsonRpcProvider(localDeployment.rpcUrl);
    }

    return new ethers.BrowserProvider(window.ethereum);
  }, [connectionMode]);

  const getSigner = useCallback(async () => {
    if (connectionMode === "local") {
      const provider = new ethers.JsonRpcProvider(localDeployment.rpcUrl);
      const wallet = await provider.getSigner(1);

      return new ethers.NonceManager(wallet);
    }

    if (!window.ethereum) {
      throw new Error("MetaMask or another injected wallet is required.");
    }

    const provider = new ethers.BrowserProvider(window.ethereum);
    return provider.getSigner();
  }, [connectionMode]);

  const refreshBalances = useCallback(
    async (
      address = account,
      merchant = merchantAddress,
      provider: ethers.Provider = getReadProvider()
    ) => {
      if (!address || !isConfigured || !isAddress(merchant)) {
        return;
      }

      const gld = getGldContract(provider);
      const usdc = getUsdcContract(provider);

      const [
        accountGld,
        accountUsdc,
        merchantGld,
        merchantUsdc,
        network,
      ] = await Promise.all([
        gld.balanceOf(address),
        usdc.balanceOf(address),
        gld.balanceOf(merchant),
        usdc.balanceOf(merchant),
        provider.getNetwork(),
      ]);

      setBalances({
        accountGld,
        accountUsdc,
        merchantGld,
        merchantUsdc,
      });
      setWalletChainId(Number(network.chainId));
    },
    [account, getReadProvider, isConfigured, merchantAddress]
  );

  async function connectLocalWallet(isAutomatic = false) {
    if (!isAutomatic) {
      markButtonClick("Use local demo wallet");
    }

    try {
      setIsPending(true);
      const provider = new ethers.JsonRpcProvider(localDeployment.rpcUrl);
      const wallet = await provider.getSigner(1);
      const network = await provider.getNetwork();
      const nextAccount = await wallet.getAddress();

      setConnectionMode("local");
      setAccount(nextAccount);
      setWalletChainId(Number(network.chainId));
      setStatus(`${isAutomatic ? "Auto-connected" : "Connected"} local Hardhat demo wallet ${shortAddress(nextAccount)}.`);
      appendEvent(`${isAutomatic ? "Auto-connected" : "Connected"} local demo wallet ${shortAddress(nextAccount)}`);
      await refreshBalances(nextAccount, merchantAddress, provider);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Local demo wallet connection failed.");
    } finally {
      setIsPending(false);
    }
  }

  async function connectInjectedWallet() {
    markButtonClick("Connect MetaMask");
    try {
      setIsPending(true);
      if (!window.ethereum) {
        setStatus("No browser wallet found. Use the local demo wallet button for this prototype.");
        return;
      }

      const provider = new ethers.BrowserProvider(window.ethereum);
      const accounts = await provider.send("eth_requestAccounts", []);
      const nextAccount = accounts[0] as string;
      const network = await provider.getNetwork();

      setConnectionMode("injected");
      setAccount(nextAccount);
      setWalletChainId(Number(network.chainId));
      setStatus(`Connected ${shortAddress(nextAccount)}.`);
      appendEvent(`Connected wallet ${shortAddress(nextAccount)}`);
      await refreshBalances(nextAccount);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Wallet connection failed.");
    } finally {
      setIsPending(false);
    }
  }

  useEffect(() => {
    if (hasAutoConnected.current || account || !isConfigured) {
      return;
    }

    hasAutoConnected.current = true;
    void connectLocalWallet(true);
    // Auto-connect should run once per page load; connectLocalWallet changes as transaction state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, isConfigured]);

  async function switchToLocalChain() {
    markButtonClick("Switch network");
    if (connectionMode === "local") {
      setWalletChainId(expectedChainId);
      setStatus("The local demo wallet already uses the Hardhat chain.");
      await refreshBalances();
      return;
    }

    if (!window.ethereum) {
      setStatus("MetaMask or another injected wallet is required.");
      return;
    }

    const chainIdHex = `0x${expectedChainId.toString(16)}`;

    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: chainIdHex }],
      });
      setWalletChainId(expectedChainId);
      setStatus("Switched to the local Hardhat chain.");
      await refreshBalances();
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? (error as { code: number }).code
          : null;

      if (code !== 4902) {
        setStatus(error instanceof Error ? error.message : "Could not switch networks.");
        return;
      }

      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: chainIdHex,
            chainName: "Hardhat Localhost",
            nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
            rpcUrls: [localDeployment.rpcUrl],
          },
        ],
      });
      setWalletChainId(expectedChainId);
      setStatus("Added the local Hardhat chain.");
    }
  }

  async function mintUsdc() {
    markButtonClick("Mint USDC");
    await runTransaction("Minting 1,000 demo USDC...", async (signer) => {
      const usdc = getUsdcContract(signer);
      const tx = await usdc.mint(account, ethers.parseUnits("1000", 6));
      await tx.wait();
      setStatus("Minted 1,000 demo USDC.");
      appendEvent("Minted 1,000 demo USDC");
    });
  }

  async function buyGld() {
    markButtonClick("Buy settlement token");
    await runTransaction("Buying settlement token...", async (signer) => {
      const gldAmount = ethers.parseUnits(buyAmount || "0", 6);
      const gld = getGldContract(signer);
      const usdc = getUsdcContract(signer);
      const paymentAmountDue = await gld.calculatePaymentTokenForGld(
        contracts.UsdcTest,
        gldAmount,
        true
      );

      const approveTx = await usdc.approve(contracts.Gld, paymentAmountDue);
      await approveTx.wait();

      const swapTx = await gld.swapSupportedTokenForGld(
        contracts.UsdcTest,
        paymentAmountDue,
        gldAmount,
        true
      );
      await swapTx.wait();
      setStatus(`Bought ${buyAmount} GLD for ${formatToken(paymentAmountDue)} demo USDC.`);
      appendEvent(`Bought ${buyAmount} GLD`);
    });
  }

  async function redeemGld() {
    markButtonClick("Redeem settlement token");
    await runTransaction("Redeeming settlement token...", async (signer) => {
      const amount = ethers.parseUnits(redeemAmount || "0", 6);
      const gld = getGldContract(signer);
      const tx = await gld.redeemGld(amount, `LOCAL-DEMO-${Date.now()}`);
      await tx.wait();
      setStatus(`Redeemed ${redeemAmount} GLD request.`);
      appendEvent(`Redeemed ${redeemAmount} GLD request`);
    });
  }

  async function payMerchant() {
    markButtonClick("Pay merchant");
    await runTransaction("Sending merchant payment through the payment core...", async (signer) => {
      if (!isAddress(merchantAddress)) {
        throw new Error("Enter a valid merchant wallet address.");
      }

      const amount = ethers.parseUnits(paymentAmount || "0", 6);
      const core = getPaymentCoreContract(signer);
      const token = paymentToken === "GLD" ? getGldContract(signer) : getUsdcContract(signer);
      const fee = await core.calculateFee(selectedPaymentTokenAddress, amount);
      const approvalAmount = amount + fee;

      const approveTx = await token.approve(contracts.PaymentCore, approvalAmount);
      await approveTx.wait();

      const payTx = await core.transferWithFeeFrom(
        selectedPaymentTokenAddress,
        merchantAddress,
        amount,
        true
      );
      await payTx.wait();
      setStatus(`Paid ${paymentAmount} ${paymentToken} to ${shortAddress(merchantAddress)}.`);
      appendEvent(`Paid merchant ${paymentAmount} ${paymentToken}; fee ${formatToken(fee)}`);
    });
  }

  async function sellForTreasuries() {
    markButtonClick("Create Treasury order");
    await runTransaction("Preparing Treasury execution package...", async (signer) => {
      const amount = ethers.parseUnits(treasuryAmount || "0", 6);
      const orderId = `TREASURY-${Date.now()}`;
      const gld = getGldContract(signer);
      const tx = await gld.redeemGld(amount, orderId);
      const receipt = await tx.wait();

      const response = await fetch("/api/demo/treasury-orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orderId,
          walletAddress: account,
          gldAmount: treasuryAmount,
          treasuryProduct,
          burnTransactionHash: receipt?.hash ?? tx.hash,
        }),
      });

      if (!response.ok) {
        throw new Error("Treasury execution adapter rejected the order.");
      }

      const order = (await response.json()) as TreasuryOrder;
      setLastTreasuryOrder(order);
      setStatus(`Prepared ${order.treasuryProduct} execution package ${order.orderId}.`);
      appendEvent(`Treasury execution ${order.orderId}: ${order.estimatedTreasuryAmount}`);
    });
  }

  async function runTransaction(
    pendingMessage: string,
    action: (signer: ethers.Signer) => Promise<void>
  ) {
    if (isTransactionInFlight.current) {
      setStatus("A transaction is already running. Wait for it to finish before clicking another action.");
      return;
    }

    if (!account) {
      setStatus("Connect a wallet first.");
      return;
    }

    if (!isConfigured) {
      setStatus("Run the local deploy script before using the demo.");
      return;
    }

    if (isWrongNetwork) {
      setStatus(`Switch to chain ${expectedChainId} before sending a transaction.`);
      return;
    }

    try {
      isTransactionInFlight.current = true;
      setIsPending(true);
      setStatus(pendingMessage);
      const signer = await getSigner();
      await action(signer);
      await refreshBalances();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Transaction failed.");
    } finally {
      isTransactionInFlight.current = false;
      setIsPending(false);
    }
  }

  return (
    <section className="mt-10 rounded-lg border border-neutral-200 bg-white px-6 py-8 text-left shadow-sm">
      <div className="mx-auto max-w-5xl">
        <div className="grid gap-6 lg:grid-cols-[1.4fr_0.8fr]">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-amber-700">
              Local capital-markets prototype
            </p>
            <h1 className="mt-3 font-display text-4xl font-medium text-neutral-950">
              Settlement and Treasury execution console
            </h1>
            <p className="mt-3 max-w-3xl text-base text-neutral-600">
              Demonstrates token settlement, merchant payment routing, redemption requests, and a broker-adapter path for Treasury execution review.
            </p>
          </div>
          <div className="rounded-lg border border-neutral-200 bg-neutral-950 p-5 text-white">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-300">
              Execution lifecycle
            </p>
            <ol className="mt-4 space-y-3 text-sm text-neutral-200">
              <li>1. Fund wallet with demo USDC</li>
              <li>2. Swap USDC into GLD</li>
              <li>3. Route merchant payment or redeem to gold</li>
              <li>4. Prepare Treasury order package for broker review</li>
            </ol>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <Button type="button" onClick={() => connectLocalWallet()} disabled={isPending || !isConfigured}>
            {connectionMode === "local" ? "Reconnect local wallet" : "Use local demo wallet"}
          </Button>
          <Button type="button" variant="outline" onClick={connectInjectedWallet} disabled={isPending || !isConfigured}>
            {connectionMode === "injected" ? "Reconnect MetaMask" : "Connect MetaMask"}
          </Button>
          {isWrongNetwork ? (
            <Button type="button" variant="outline" onClick={switchToLocalChain} disabled={isPending}>
              Switch network
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={mintUsdc} disabled={isPending || !account || !isConfigured}>
            Mint USDC
          </Button>
          <Button type="button" variant="outline" onClick={() => refreshBalances()} disabled={isPending || !account || !isConfigured}>
            Refresh
          </Button>
        </div>

        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-neutral-900">
          Status: {status}
        </p>

        <p className="mt-4 break-words text-xs text-neutral-500">{deploymentSummary}</p>

        <dl className="mt-6 grid gap-4 text-sm text-neutral-700 md:grid-cols-4">
          <BalanceCard label="Wallet" value={account ? shortAddress(account) : "Not connected"} />
          <BalanceCard label="Mode" value={connectionMode === "local" ? "Local Hardhat" : connectionMode === "injected" ? "Browser wallet" : "Not connected"} />
          <BalanceCard label="Your GLD" value={formatToken(balances.accountGld)} />
          <BalanceCard label="Your demo USDC" value={formatToken(balances.accountUsdc)} />
          <BalanceCard label="Chain" value={walletChainId ? String(walletChainId) : "Not connected"} />
          <BalanceCard label="Client" value={isClientReady ? `Ready, ${clickCount} clicks` : "Not hydrated"} />
          <BalanceCard label="Merchant" value={isAddress(merchantAddress) ? shortAddress(merchantAddress) : "Invalid"} />
          <BalanceCard label="Merchant GLD" value={formatToken(balances.merchantGld)} />
          <BalanceCard label="Merchant demo USDC" value={formatToken(balances.merchantUsdc)} />
          <BalanceCard label="Payment fee" value="2%" />
        </dl>

        <div className="mt-8 grid gap-5 lg:grid-cols-2">
          <DemoPanel title="Buy GLD and redeem">
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Buy GLD amount" value={buyAmount} onChange={setBuyAmount} />
              <TextField label="Redeem GLD amount" value={redeemAmount} onChange={setRedeemAmount} />
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button type="button" onClick={buyGld} disabled={isPending || !account || !isConfigured}>
                Buy GLD
              </Button>
              <Button type="button" variant="outline" onClick={redeemGld} disabled={isPending || !account || !isConfigured}>
                Redeem GLD
              </Button>
            </div>
          </DemoPanel>

          <DemoPanel title="Pay merchant through PaymentCore">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-medium text-neutral-900">
                Payment token
                <select
                  value={paymentToken}
                  onChange={(event) => setPaymentToken(event.target.value as TokenKey)}
                  className="mt-2 w-full rounded-lg border border-neutral-300 px-3 py-2 text-neutral-950"
                >
                  <option value="GLD">GLD</option>
                  <option value="USDC">Demo USDC</option>
                </select>
              </label>
              <TextField label="Payment amount" value={paymentAmount} onChange={setPaymentAmount} />
            </div>
            <TextField label="Merchant wallet" value={merchantAddress} onChange={setMerchantAddress} />
            <div className="mt-4">
              <Button type="button" onClick={payMerchant} disabled={isPending || !account || !isConfigured}>
                Pay merchant
              </Button>
            </div>
          </DemoPanel>

          <DemoPanel title="Treasury execution adapter">
            <p className="text-sm text-neutral-600">
              Redeems GLD, captures the burn transaction, estimates available notional, and prepares a server-side order package that can route through Interactive Brokers when brokerage credentials and account approvals are configured.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="GLD allocation" value={treasuryAmount} onChange={setTreasuryAmount} />
              <TextField label="Treasury product" value={treasuryProduct} onChange={setTreasuryProduct} />
            </div>
            <div className="mt-4">
              <Button type="button" onClick={sellForTreasuries} disabled={isPending || !account || !isConfigured}>
                Prepare Treasury execution
              </Button>
            </div>
            {lastTreasuryOrder ? (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-neutral-800">
                <p className="font-semibold text-neutral-950">{lastTreasuryOrder.orderId}</p>
                <p>{lastTreasuryOrder.status}</p>
                <p>{lastTreasuryOrder.executionVenue}</p>
                <p>{lastTreasuryOrder.estimatedTreasuryAmount}</p>
                <p>Broker status: {lastTreasuryOrder.brokerOrderStatus}</p>
                <p>Broker order id: {lastTreasuryOrder.brokerOrderId ?? "Not submitted"}</p>
                <ul className="mt-3 space-y-1">
                  {lastTreasuryOrder.regulatoryNotes.map((note) => (
                    <li key={note}>- {note}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </DemoPanel>

          <DemoPanel title="Transaction log">
            <p className="rounded-lg bg-neutral-100 px-4 py-3 text-sm text-neutral-700">
              {status}
            </p>
            <ul className="mt-4 space-y-2 text-sm text-neutral-600">
              {events.length > 0 ? (
                events.map((event, index) => <li key={`${event}-${index}`}>{event}</li>)
              ) : (
                <li>No local transactions yet.</li>
              )}
            </ul>
          </DemoPanel>
        </div>
      </div>
    </section>
  );
}

function BalanceCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 px-4 py-3">
      <dt className="font-semibold text-neutral-950">{label}</dt>
      <dd className="mt-1 break-words">{value}</dd>
    </div>
  );
}

function DemoPanel({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 p-5">
      <h2 className="font-display text-xl font-medium text-neutral-950">{title}</h2>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="mt-4 block text-sm font-medium text-neutral-900">
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 w-full rounded-lg border border-neutral-300 px-3 py-2 text-neutral-950"
        inputMode="decimal"
      />
    </label>
  );
}
