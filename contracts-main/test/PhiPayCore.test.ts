import { ethers } from "hardhat";
import { Signer } from "ethers";
import { PhiPayCore } from "../src/types/contracts/PhiPayCore";
import { OmegapayComplianceRegistry } from "../src/types/contracts/OmegapayComplianceRegistry";
import { UsdcTest } from "../src/types/contracts/UsdcTest";
import { deployContract } from "./helpers";
import { expect } from "chai";

describe("PhiPayCore Contract", function () {
  let phiPayCore: PhiPayCore;
  let complianceRegistry: OmegapayComplianceRegistry;
  let mockUSDC: UsdcTest;
  let owner: Signer;
  let user: Signer;
  let recipient: Signer;
  let admin: Signer;

  const INITIAL_USER_BALANCE = ethers.parseUnits("10000", 6);
  const MIN_TRANSFER = ethers.parseUnits("1", 6);
  const MAX_NON_VERIFIED = ethers.parseUnits("100", 6);

  beforeEach(async function () {
    [owner, user, recipient, admin] = await ethers.getSigners();

    // Deploy Compliance Registry
    complianceRegistry = (await deployContract("OmegapayComplianceRegistry", [
      await admin.getAddress(),
    ])) as unknown as OmegapayComplianceRegistry;

    // Deploy PhiPayCore
    phiPayCore = (await deployContract("PhiPayCore", [
      await complianceRegistry.getAddress(),
    ])) as unknown as PhiPayCore;

    // Deploy Mock USDC
    mockUSDC = (await deployContract("UsdcTest", [])) as unknown as UsdcTest;

    // Mint USDC to user
    await mockUSDC.mint(await user.getAddress(), INITIAL_USER_BALANCE);

    // Add USDC as supported token
    await phiPayCore.addSupportedToken(
      await mockUSDC.getAddress(),
      MIN_TRANSFER,
      MAX_NON_VERIFIED,
      ethers.parseUnits("10", 6) // Max fee cap
    );

    // Approve PhiPayCore to spend user's USDC
    await mockUSDC
      .connect(user)
      .approve(await phiPayCore.getAddress(), ethers.MaxUint256);
  });

  describe("Configuration", function () {
    it("Should have correct owner", async function () {
      expect(await phiPayCore.owner()).to.equal(await owner.getAddress());
    });

    it("Should have correct initial service fee", async function () {
      expect(await phiPayCore.serviceFeeBps()).to.equal(200); // 2%
    });

    it("Should allow updating service fee collector", async function () {
      await phiPayCore.setServiceFeeCollector(await recipient.getAddress());
      expect(await phiPayCore.serviceFeeCollector()).to.equal(
        await recipient.getAddress()
      );
    });
  });

  describe("Transfers", function () {
    it("Should transfer tokens when sender pays fee", async function () {
      const amount = ethers.parseUnits("100", 6);
      // Fee is 2% = 2 USDC
      const fee = ethers.parseUnits("2", 6);
      const totalDebit = amount + fee;

      // Register recipient (not strictly needed for basic transfer but good practice if blacklist check exists)
      // complianceRegistry checks blacklist only.

      const tx = await phiPayCore
        .connect(user)
        .transferWithFeeFrom(
          await mockUSDC.getAddress(),
          await recipient.getAddress(),
          amount,
          true // senderPaysFee
        );

      await expect(tx)
        .to.emit(phiPayCore, "TransferWithFees")
        .withArgs(
          await mockUSDC.getAddress(),
          await user.getAddress(),
          await recipient.getAddress(),
          totalDebit,
          amount,
          fee,
          (await ethers.provider.getBlock(tx.blockNumber!))!.timestamp
        );

      expect(await mockUSDC.balanceOf(await recipient.getAddress())).to.equal(
        amount
      );
      expect(await phiPayCore.serviceFeeBalance(await mockUSDC.getAddress())).to.equal(
        fee
      );
    });

    it("Should transfer tokens when recipient pays fee", async function () {
      const amount = ethers.parseUnits("100", 6);
      // Fee is 2% = 2 USDC calculated on amount
      const fee = ethers.parseUnits("2", 6);
      const recipientNet = amount - fee;

      await phiPayCore
        .connect(user)
        .transferWithFeeFrom(
          await mockUSDC.getAddress(),
          await recipient.getAddress(),
          amount,
          false // senderPaysFee (recipient pays)
        );

      expect(await mockUSDC.balanceOf(await recipient.getAddress())).to.equal(
        recipientNet
      );
      expect(await phiPayCore.serviceFeeBalance(await mockUSDC.getAddress())).to.equal(
        fee
      );
    });

    it("Should enforce min transfer amount", async function () {
      const amount = ethers.parseUnits("0.5", 6); // Below min 1.0
      await expect(
        phiPayCore
          .connect(user)
          .transferWithFeeFrom(
            await mockUSDC.getAddress(),
            await recipient.getAddress(),
            amount,
            true
          )
      ).to.be.revertedWith("below min transfer amount");
    });

    it("Should enforce max non-verified transfer amount", async function () {
      const amount = ethers.parseUnits("200", 6); // Above max 100
      // User is not verified by default
      await expect(
        phiPayCore
          .connect(user)
          .transferWithFeeFrom(
            await mockUSDC.getAddress(),
            await recipient.getAddress(),
            amount,
            true
          )
      ).to.be.revertedWith("above max non verified transfer amount");
    });

    it("Should allow large transfers for verified users", async function () {
      const amount = ethers.parseUnits("200", 6);
      
      // Verify user
      // Registry: refreshKYCExpiration(user)
      await complianceRegistry
        .connect(admin)
        .refreshKYCExpiration(await user.getAddress());

      await phiPayCore
        .connect(user)
        .transferWithFeeFrom(
          await mockUSDC.getAddress(),
          await recipient.getAddress(),
          amount,
          true
        );

      expect(await mockUSDC.balanceOf(await recipient.getAddress())).to.equal(
        amount
      );
    });

    it("Should block blacklisted recipients", async function () {
      const amount = ethers.parseUnits("10", 6);
      await complianceRegistry
        .connect(admin)
        .setBlacklist(await recipient.getAddress(), true);

      await expect(
        phiPayCore
          .connect(user)
          .transferWithFeeFrom(
            await mockUSDC.getAddress(),
            await recipient.getAddress(),
            amount,
            true
          )
      ).to.be.revertedWith("recipient is blacklisted");
    });
  });

  describe("Fees", function () {
    it("Should cap fees at maxServiceFee", async function () {
        // Set max fee to 1.5 USDC
        const maxFee = ethers.parseUnits("1.5", 6);
        await phiPayCore.setTokenFeeCaps(await mockUSDC.getAddress(), maxFee);

        // Transfer 200 USDC -> 2% is 4 USDC, should be capped at 1.5
        const amount = ethers.parseUnits("200", 6);
        
        // Verify user to allow > 100
        await complianceRegistry.connect(admin).refreshKYCExpiration(await user.getAddress());

        await phiPayCore
            .connect(user)
            .transferWithFeeFrom(
                await mockUSDC.getAddress(),
                await recipient.getAddress(),
                amount,
                true
            );

        expect(await phiPayCore.serviceFeeBalance(await mockUSDC.getAddress())).to.equal(maxFee);
    });

    it("Should allow withdrawing fees", async function () {
        const amount = ethers.parseUnits("100", 6);
        await phiPayCore.connect(user).transferWithFeeFrom(
            await mockUSDC.getAddress(), 
            await recipient.getAddress(), 
            amount, 
            true
        );

        const initialBalance = await mockUSDC.balanceOf(await owner.getAddress()); // owner is fee collector
        const fee = ethers.parseUnits("2", 6);

        await phiPayCore.connect(owner).withdrawServiceFees(await mockUSDC.getAddress());

        expect(await mockUSDC.balanceOf(await owner.getAddress())).to.equal(initialBalance + fee);
        expect(await phiPayCore.serviceFeeBalance(await mockUSDC.getAddress())).to.equal(0);
    });
  });
});
