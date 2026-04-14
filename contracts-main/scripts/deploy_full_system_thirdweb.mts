import {
  createThirdwebClient,
  getContract,
  prepareContractCall,
  sendTransaction,
  waitForReceipt,
  readContract,
} from "thirdweb";
import { deployContract } from "thirdweb/deploys";
import { privateKeyToAccount } from "thirdweb/wallets";
import { defineChain } from "thirdweb/chains";
import * as fs from "fs";
import * as path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

dotenv.config();

// Polyfill __filename and __dirname for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to wait
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function sendTransactionWithRetry(
  tx: any,
  account: any,
  maxRetries = 5,
  delayMs = 5000
) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const result = await sendTransaction({ transaction: tx, account });
      const receipt = await waitForReceipt(result);
      return receipt;
    } catch (error: any) {
      console.warn(
        `⚠️ Transaction failed (attempt ${i + 1}/${maxRetries}): ${
          error.message || error
        }`
      );
      if (i < maxRetries - 1) {
        console.log(`Waiting ${delayMs / 1000}s before retrying...`);
        await sleep(delayMs);
      } else {
        console.error("❌ Max retries reached. Failing.");
        throw error;
      }
    }
  }
}

// Configuration
const DEPLOYMENT_KEY = process.env.DEPLOYMENT_KEY || ""; // Or specific network key
const THIRDWEB_SECRET_KEY = process.env.THIRDWEB_SECRET_KEY || ""; // Need secret key for backend scripts

// Parse Chain ID from args or default to 31337 (Localhost)
const args = process.argv.slice(2);
const CHAIN_ID = args.length > 0 ? parseInt(args[0]) : 31337;
const validIPFSCIDv0 = "QmPK1s3pNYLi9ERiq3BDxKa4XosgWwFRQUydHUtz4YgpqB";
const USDC_ADDRESS =
  process.env.DEPLOYED_AMOY_USDC_ADDRESS ||
  process.env.DEPLOYED_AMOY_TEST_USDC_ADDRESS ||
  "";

if (!USDC_ADDRESS) {
  throw new Error("Missing USDC_ADDRESS in .env");
}

if (!DEPLOYMENT_KEY || !THIRDWEB_SECRET_KEY) {
  throw new Error("Missing DEPLOYMENT_KEY or THIRDWEB_SECRET_KEY in .env");
}

// Initialize Client & Account
const client = createThirdwebClient({
  secretKey: process.env.THIRDWEB_SECRET_KEY!,
});
const chain = defineChain(CHAIN_ID);
const account = privateKeyToAccount({
  client,
  privateKey: process.env.DEPLOYMENT_KEY!,
});

// Helper to load artifacts
function getArtifact(contractName: string) {
  const artifactPath = path.join(
    __dirname,
    `../artifacts/contracts/${contractName}.sol/${contractName}.json`
  );
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  return { abi: artifact.abi, bytecode: artifact.bytecode };
}

async function main() {
  console.log(
    `🚀 Deploying to chain ${CHAIN_ID} with account ${account.address}`
  );

  // 1. Deploy OmegapayComplianceRegistry
  console.log("Deploying OmegapayComplianceRegistry...");
  const complianceArtifact = getArtifact("OmegapayComplianceRegistry");
  const complianceAddress = await deployContract({
    client,
    chain,
    account,
    bytecode: complianceArtifact.bytecode,
    abi: complianceArtifact.abi,
    constructorParams: {
      _complianceAdmin: "0xABc8A7596AFcE6635117795f0d8E74C3CE8fcaB7",
    }, // Steven's address for initial compliance admin
  });
  console.log("✅ OmegapayComplianceRegistry:", complianceAddress);

  // 2. Deploy PhiPayCore
  console.log("Deploying PhiPayCore...");
  const coreArtifact = getArtifact("PhiPayCore");
  const coreAddress = await deployContract({
    client,
    chain,
    account,
    bytecode: coreArtifact.bytecode,
    abi: coreArtifact.abi,
    constructorParams: { _kycRegistry: complianceAddress },
  });
  console.log("✅ PhiPayCore:", coreAddress);

  // 3. Deploy GldAuditRegistry
  console.log("Deploying GldAuditRegistry...");
  const auditArtifact = getArtifact("GldAuditRegistry");
  const auditAddress = await deployContract({
    client,
    chain,
    account,
    bytecode: auditArtifact.bytecode,
    abi: auditArtifact.abi,
    constructorParams: {},
  });
  console.log("✅ GldAuditRegistry:", auditAddress);

  // 4. Deploy Gld
  console.log("Deploying Gld...");
  const gldArtifact = getArtifact("Gld");
  const gldAddress = await deployContract({
    client,
    chain,
    account,
    bytecode: gldArtifact.bytecode,
    abi: gldArtifact.abi,
    constructorParams: { _auditRegistry: auditAddress },
  });
  console.log("✅ Gld:", gldAddress);
  // get audit registry address from gld
  const gld = getContract({
    client,
    chain,
    address: gldAddress,
    abi: gldArtifact.abi,
  });
  const auditRegistryAddress = await readContract({
    contract: gld,
    method: "getAuditRegistry",
    params: [],
  });
  console.log("✅ Audit Registry:", auditRegistryAddress);
  // ==========================================
  // Post-Deployment Setup
  // ==========================================
  console.log("\n🔗 Linking contracts...");

  // Initialize contract instances
  const auditRegistry = getContract({
    client,
    chain,
    address: auditAddress,
    abi: auditArtifact.abi,
  });
  const phiPayCore = getContract({
    client,
    chain,
    address: coreAddress,
    abi: coreArtifact.abi,
  });

  // Link Audit Registry -> Gld
  console.log("Setting Gld contract in Audit Registry...");
  const setGldInRegistryTx = prepareContractCall({
    contract: auditRegistry,
    method: "setGldContract",
    params: [gldAddress],
  });
  await sendTransaction({ transaction: setGldInRegistryTx, account });
  console.log("Done.");

  // Configure PhiPayCore (Add USDC and Gld as supported token)
  console.log("Adding USDC as supported token in PhiPayCore...");
  const addUsdcTx = prepareContractCall({
    contract: phiPayCore,
    method: "addSupportedToken",
    params: [
      USDC_ADDRESS,
      BigInt("100000"), // Min .1 USDC send amount
      BigInt("100000000"), // Max 100 USDC send amount unverified
      BigInt("10000000"), // Max 10 USDC send amount fee cap
    ],
  });
  await sendTransaction({ transaction: addUsdcTx, account });
  console.log("Done.");

  console.log("Adding Gld as supported token in PhiPayCore...");
  const addGldTx = prepareContractCall({
    contract: phiPayCore,
    method: "addSupportedToken",
    params: [
      gldAddress,
      BigInt("1000"), // Min .001 Gld send amount
      BigInt("1000000"), // Max 1 Gld send amount unverified
      BigInt("100000"), // Max .1 Gld send amount fee cap
    ],
  });
  await sendTransaction({ transaction: addGldTx, account });
  console.log("Done.");

  // Mint Gld supply
  console.log("Minting Gld supply...");
  const mintTx = prepareContractCall({
    contract: gld,
    method: "mintGldSupply",
    params: [10000000000n, validIPFSCIDv0], // 10000 Gld supply
  });
  await sendTransactionWithRetry(mintTx, account);
  console.log("Done.");

  // Save addresses to deployment-addresses-thirdweb.json
  const deployments = {
    OmegapayComplianceRegistry: complianceAddress,
    PhiPayCore: coreAddress,
    Gld: gldAddress,
    GldAuditRegistry: auditAddress,
  };

  fs.writeFileSync(
    "deployment-addresses-thirdweb.json",
    JSON.stringify(deployments, null, 2)
  );
  console.log(
    "\n🎉 Deployment Complete! Addresses saved to deployment-addresses-thirdweb.json"
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
