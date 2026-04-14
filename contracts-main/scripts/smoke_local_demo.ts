import fs from "fs";
import path from "path";
import { ethers } from "hardhat";

async function main() {
  const deploymentPath = path.resolve(__dirname, "../deployment-addresses-local.json");
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8")) as {
    contracts: {
      Gld: string;
      PaymentCore: string;
      UsdcTest: string;
    };
  };

  const [, user] = await ethers.getSigners();
  const merchant = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
  const gld = await ethers.getContractAt("Gld", deployment.contracts.Gld, user);
  const phiPayCore = await ethers.getContractAt("PhiPayCore", deployment.contracts.PaymentCore, user);
  const usdc = await ethers.getContractAt("UsdcTest", deployment.contracts.UsdcTest, user);

  const userAddress = await user.getAddress();
  const gldAmount = ethers.parseUnits("10", 6);
  const paymentAmount = await gld.calculatePaymentTokenForGld(
    deployment.contracts.UsdcTest,
    gldAmount,
    true
  );

  await (await usdc.mint(userAddress, paymentAmount)).wait();
  await (await usdc.approve(deployment.contracts.Gld, paymentAmount)).wait();
  await (
    await gld.swapSupportedTokenForGld(
      deployment.contracts.UsdcTest,
      paymentAmount,
      gldAmount,
      true
    )
  ).wait();

  const balanceAfterBuy = await gld.balanceOf(userAddress);
  const merchantPaymentAmount = ethers.parseUnits("1", 6);
  const merchantPaymentFee = await phiPayCore.calculateFee(
    deployment.contracts.Gld,
    merchantPaymentAmount
  );
  await (
    await gld.approve(
      deployment.contracts.PaymentCore,
      merchantPaymentAmount + merchantPaymentFee
    )
  ).wait();
  await (
    await phiPayCore.transferWithFeeFrom(
      deployment.contracts.Gld,
      merchant,
      merchantPaymentAmount,
      true
    )
  ).wait();
  const merchantBalanceAfterPayment = await gld.balanceOf(merchant);

  const redeemAmount = ethers.parseUnits("5", 6);
  await (await gld.redeemGld(redeemAmount, "LOCAL-SMOKE")).wait();
  const balanceAfterRedeem = await gld.balanceOf(userAddress);

  console.log(`Smoke user: ${userAddress}`);
  console.log(`Paid demo USDC: ${ethers.formatUnits(paymentAmount, 6)}`);
  console.log(`GLD after buy: ${ethers.formatUnits(balanceAfterBuy, 6)}`);
  console.log(`Merchant GLD after payment: ${ethers.formatUnits(merchantBalanceAfterPayment, 6)}`);
  console.log(`GLD after redeem: ${ethers.formatUnits(balanceAfterRedeem, 6)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
