import fs from "fs";
import path from "path";
import { ethers } from "hardhat";

const VALID_IPFS_CID = "QmPK1s3pNYLi9ERiq3BDxKa4XosgWwFRQUydHUtz4YgpqB";

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log(
    `Deploying local PhiGold demo contracts to chain ${network.chainId} from ${deployer.address}`
  );

  const AuditRegistry = await ethers.getContractFactory("GldAuditRegistry");
  const auditRegistry = await AuditRegistry.deploy();
  await auditRegistry.waitForDeployment();

  const Gld = await ethers.getContractFactory("Gld");
  const gld = await Gld.deploy(await auditRegistry.getAddress());
  await gld.waitForDeployment();

  const UsdcTest = await ethers.getContractFactory("UsdcTest");
  const usdc = await UsdcTest.deploy();
  await usdc.waitForDeployment();

  const ComplianceRegistry = await ethers.getContractFactory("OmegapayComplianceRegistry");
  const complianceRegistry = await ComplianceRegistry.deploy(deployer.address);
  await complianceRegistry.waitForDeployment();

  const PhiPayCore = await ethers.getContractFactory("PhiPayCore");
  const phiPayCore = await PhiPayCore.deploy(await complianceRegistry.getAddress());
  await phiPayCore.waitForDeployment();

  await (await auditRegistry.setGldContract(await gld.getAddress())).wait();

  await (
    await gld.mintGldSupply(
      ethers.parseUnits("1000000", 6),
      VALID_IPFS_CID
    )
  ).wait();

  await (
    await gld.addSupportedToken(
      await usdc.getAddress(),
      ethers.parseUnits("100", 6)
    )
  ).wait();

  await (
    await phiPayCore.addSupportedToken(
      await usdc.getAddress(),
      ethers.parseUnits("1", 6),
      ethers.parseUnits("10000", 6),
      ethers.parseUnits("10", 6)
    )
  ).wait();

  await (
    await phiPayCore.addSupportedToken(
      await gld.getAddress(),
      ethers.parseUnits("0.001", 6),
      ethers.parseUnits("10000", 6),
      ethers.parseUnits("0.1", 6)
    )
  ).wait();

  const deployment = {
    chainId: Number(network.chainId),
    rpcUrl: "http://127.0.0.1:8545",
    contracts: {
      Gld: await gld.getAddress(),
      PaymentCore: await phiPayCore.getAddress(),
      UsdcTest: await usdc.getAddress(),
    },
  };

  const contractsOutputPath = path.resolve(
    __dirname,
    "../deployment-addresses-local.json"
  );
  const frontendOutputPath = path.resolve(
    __dirname,
    "../../landing-page-main/src/lib/contracts/localDeployment.json"
  );

  fs.writeFileSync(contractsOutputPath, JSON.stringify(deployment, null, 2));
  fs.mkdirSync(path.dirname(frontendOutputPath), { recursive: true });
  fs.writeFileSync(frontendOutputPath, JSON.stringify(deployment, null, 2));

  console.log("Local demo deployment complete:");
  console.log(JSON.stringify(deployment, null, 2));
  console.log(`Wrote ${contractsOutputPath}`);
  console.log(`Wrote ${frontendOutputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
