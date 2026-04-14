import { expect } from "chai";
import {
    ContractFactory,
    Signer,
    parseUnits,
} from "ethers";
import { ethers } from "hardhat";
import { GldBond } from "../src/types/contracts/GldBond";

describe("GldBond Contract", function () {
  let GldBond: ContractFactory,
    gldBond: GldBond,
    owner: Signer,
    customer: Signer,
    authorizedRedeemer: Signer;

  beforeEach(async function () {
    GldBond = await ethers.getContractFactory("GldBond");
    [owner, customer, authorizedRedeemer] = await ethers.getSigners();
    gldBond = (await GldBond.deploy()) as GldBond;
  });

  describe("mintBond", function () {
    it("Should mint a bond with correct details", async function () {
      const gldAmount = parseUnits("100", 6);
      await gldBond.connect(owner).mintBond(await customer.getAddress(), gldAmount);

      const bond = await gldBond.getBondDetails(0);
      expect(bond.gldAmount).to.equal(gldAmount * 104n / 100n); // Including 4% bonus
      expect(bond.status).to.equal(0); // Pending status
      expect(bond.redeemed).to.be.false;
    });

    it("Should revert when called by non-owner", async function () {
        const gldAmount = parseUnits("100", 6);
        await expect(gldBond.connect(customer).mintBond(await customer.getAddress(), gldAmount))
          .to.be.revertedWithCustomError(gldBond, "OwnableUnauthorizedAccount")
          .withArgs(await customer.getAddress());
      });
  });

  describe("updateBondStatus", function () {
    it("Should update bond status", async function () {
      await gldBond.connect(owner).mintBond(await customer.getAddress(), 100);
      await gldBond.connect(owner).updateBondStatus(0, 1); // Set to Purchased status
      const bond = await gldBond.getBondDetails(0);
      expect(bond.status).to.equal(1);
    });
  });

  describe("updatePurchaseOrderHash and updateAuditReportHash", function () {
    it("Should update purchase order hash and audit report hash", async function () {
      await gldBond.connect(owner).mintBond(await customer.getAddress(), 100);
      const purchaseOrderHash = ethers.id("purchaseOrder");
      const auditReportHash = ethers.id("auditReport");

      await gldBond.connect(owner).updatePurchaseOrderHash(0, purchaseOrderHash);
      await gldBond.connect(owner).updateAuditReportHash(0, auditReportHash);

      const bond = await gldBond.getBondDetails(0);
      expect(bond.purchaseOrderHash).to.equal(purchaseOrderHash);
      expect(bond.auditReportHash).to.equal(auditReportHash);
    });
  });

  describe("setRedeemed", function () {
    it("Should set bond as redeemed", async function () {
      await gldBond.connect(owner).mintBond(await customer.getAddress(), 100);
      await gldBond.connect(owner).setAuthorizedRedeemer(await authorizedRedeemer.getAddress());
      await gldBond.connect(authorizedRedeemer).setRedeemed(0);

      const bond = await gldBond.getBondDetails(0);
      expect(bond.redeemed).to.be.true;
    });

    it("Should revert when called by unauthorized address", async function () {
      await gldBond.connect(owner).mintBond(await customer.getAddress(), 100);
      await expect(gldBond.connect(customer).setRedeemed(0)).to.be.revertedWith("Only authorized redeemer can set redeemed status");
    });
  });

  describe("getBondsByOwner", function () {
    it("Should return correct bonds for an owner", async function () {
      await gldBond.connect(owner).mintBond(await customer.getAddress(), 100);
      await gldBond.connect(owner).mintBond(await customer.getAddress(), 200);

      const bonds = await gldBond.getBondsByOwner(await customer.getAddress());
      expect(bonds.length).to.equal(2);
      expect(bonds[0]).to.equal(0);
      expect(bonds[1]).to.equal(1);
    });
  });

  describe("setMaturityPeriod and setBonusPercentage", function () {
    it("Should set maturity period and bonus percentage", async function () {
      await gldBond.connect(owner).setMaturityPeriod(60 * 24 * 60 * 60); // 60 days
      await gldBond.connect(owner).setBonusPercentage(5); // 5% bonus

      expect(await gldBond.maturityPeriod()).to.equal(60 * 24 * 60 * 60);
      expect(await gldBond.bonusPercentage()).to.equal(5);
    });

    it("Should revert when setting invalid bonus percentage", async function () {
      await expect(gldBond.connect(owner).setBonusPercentage(101)).to.be.revertedWith("Bonus percentage must be <= 100");
    });
  });
});