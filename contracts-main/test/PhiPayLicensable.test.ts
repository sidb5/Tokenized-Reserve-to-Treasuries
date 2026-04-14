import { expect } from "chai";
import { ethers } from "hardhat";
import { BaseContract, Signer } from "ethers";
import { PhiPayLicensable, Gld, UsdcTest } from "../src/types/index";
import {
  deployContract,
  ERC20PermitToken,
  getPermitSignature,
  validIPFSCIDv0,
} from "./helpers";

describe("PhiPayLicensable Contract", function () {
  let gld: Gld;
  let mockUSDC: UsdcTest;
  let phiPayLicensable: PhiPayLicensable;
  let owner: Signer;
  let customer: Signer;
  let merchant: Signer;
  let operator: Signer;

  const INITIAL_SUPPLY = ethers.parseUnits("1000000", 6);
  const USDC_EXCHANGE_RATE = ethers.parseUnits("70", 6);

  async function setupTokenSupport() {
    await gld.addSupportedToken(
      await mockUSDC.getAddress(),
      USDC_EXCHANGE_RATE
    );
    await phiPayLicensable.addSupportedToken(await mockUSDC.getAddress());
    await phiPayLicensable.addSupportedToken(await gld.getAddress());
  }

  async function performInitialSwap() {
    const desiredGldAmount = ethers.parseUnits("10", 6);
    const usdcAmount = await gld.calculatePaymentTokenForGld(
      await mockUSDC.getAddress(),
      desiredGldAmount,
      true
    );
    expect(await gld.balanceOf(await gld.getAddress())).to.be.gte(
      desiredGldAmount
    );
    expect(await mockUSDC.balanceOf(await customer.getAddress())).to.be.gte(
      usdcAmount
    );

    await mockUSDC
      .connect(customer)
      .approve(await gld.getAddress(), usdcAmount);

    await gld
      .connect(customer)
      .swapSupportedTokenForGld(
        await mockUSDC.getAddress(),
        usdcAmount,
        0,
        true
      );
    expect(await gld.balanceOf(await customer.getAddress())).to.equal(
      ethers.parseUnits("10", 6)
    );
  }

  beforeEach(async function () {
    [owner, customer, merchant, operator] =
      await ethers.getSigners();

    // Deploy and setup all contracts
    mockUSDC = (await deployContract("UsdcTest", [])) as unknown as UsdcTest;
    const auditRegistry = await deployContract("GldAuditRegistry", []);
    gld = (await deployContract("Gld", [
      await auditRegistry.getAddress(),
    ])) as unknown as Gld;
    await auditRegistry.setGldContract(await gld.getAddress());

    phiPayLicensable = (await deployContract("PhiPayLicensable", [await operator.getAddress()])) as unknown as PhiPayLicensable;

    await gld.mintGldSupply(INITIAL_SUPPLY, validIPFSCIDv0);
    await mockUSDC.mint(
      await customer.getAddress(),
      ethers.parseUnits("700000000", 6)
    );

    await setupTokenSupport();
    await performInitialSwap();
  });

  describe("Token Management", function () {
    it("Should have consistent token support between contracts", async function () {
      expect(
        (await phiPayLicensable.getTokenInfo(await mockUSDC.getAddress()))
          .isSupported
      ).to.be.true;
      expect(await gld.isSupportedToken(await mockUSDC.getAddress())).to.be
        .true;
    });

    it("Should correctly add a token", async function () {
      expect(await phiPayLicensable.supportedTokenCount()).to.equal(2);
      const variableDecimalsToken = (await deployContract(
        "VariableDecimalsMockToken",
        [18]
      )) as unknown as ERC20PermitToken;
      await phiPayLicensable.addSupportedToken(
        await variableDecimalsToken.getAddress()
      );
      expect(
        (
          await phiPayLicensable.getTokenInfo(
            await variableDecimalsToken.getAddress()
          )
        ).isSupported
      ).to.be.true;
      expect(await phiPayLicensable.supportedTokenCount()).to.equal(3);
    });

    it("Should correctly remove a token", async function () {
      expect(await phiPayLicensable.supportedTokenCount()).to.equal(2);
      await phiPayLicensable.archiveSupportedToken(await mockUSDC.getAddress());
      expect(
        (await phiPayLicensable.getTokenInfo(await mockUSDC.getAddress()))
          .isSupported
      ).to.be.false;
      expect(await phiPayLicensable.supportedTokenCount()).to.equal(1);
    });

    it("Should only add tokens that implement ERC20Permit", async function () {
      const mockNonPermitToken = (await deployContract(
        "MockNonPermitToken",
        []
      )) as unknown as BaseContract;
      await expect(
        phiPayLicensable.addSupportedToken(
          await mockNonPermitToken.getAddress()
        )
      ).to.be.revertedWith("Token must implement ERC20Permit");
    });

    it("Should not add tokens with no decimals", async function () {
      const nonErc20Contract = (await deployContract(
        "NonErc20Contract",
        []
      )) as unknown as BaseContract;
      await expect(
        phiPayLicensable.addSupportedToken(await nonErc20Contract.getAddress())
      ).to.be.revertedWith("No token decimals found");
    });

    it("Should allow the owner to change token info", async function () {
      await phiPayLicensable.updateTokenInfo(
        await mockUSDC.getAddress(),
        ethers.parseUnits("1", 6),
        ethers.parseUnits("1000000", 6)
      );
      expect(
        (await phiPayLicensable.getTokenInfo(await mockUSDC.getAddress()))
          .isSupported
      ).to.be.true;

      const [
        tokenAddress,
        decimals,
        isSupported,
        minTransferAmount,
      ] = await phiPayLicensable.getTokenInfo(await mockUSDC.getAddress());
      expect(tokenAddress).to.equal(await mockUSDC.getAddress());
      expect(decimals).to.equal(6);
      expect(isSupported).to.be.true;
      expect(minTransferAmount).to.equal(ethers.parseUnits("1", 6));
    });
  });
  describe("Make Purchase", function () {
    it("Should correctly make a USDC purchase with Permit", async function () {
      const purchaseAmount = ethers.parseUnits("100", 6);
      const [serviceFee, licenseFee] = await phiPayLicensable.calculateFees(
        purchaseAmount,
        true
      );
      const totalAmount = purchaseAmount + serviceFee + licenseFee;
      const serviceFeeBalanceBefore = await mockUSDC.balanceOf(
        await phiPayLicensable.serviceFeeCollector()
      );
      const licenseFeeBalanceBefore = await mockUSDC.balanceOf(
        await phiPayLicensable.licenseFeeCollector()
      );
      const { signature, deadline } = await getPermitSignature(
        mockUSDC as unknown as ERC20PermitToken,
        customer,
        await phiPayLicensable.getAddress(),
        totalAmount
      );
      const { v, r, s } = signature;
      const makePurchaseTx = await phiPayLicensable
        .connect(operator)
        .makePurchase(
          await mockUSDC.getAddress(),
          await customer.getAddress(),
          await merchant.getAddress(),
          purchaseAmount,
          "PRODUCT_ID_123",
          deadline,
          v,
          r,
          s,
          true,
          true
        );
        await makePurchaseTx.wait();
        
        const timestamp = await ethers.provider
          .getBlock(makePurchaseTx.blockNumber!)
          .then((b) => b!.timestamp);
        expect(makePurchaseTx)
          .to.emit(phiPayLicensable, "PurchaseCompleted")
          .withArgs(
            await mockUSDC.getAddress(),
            await customer.getAddress(),
            await merchant.getAddress(),
            purchaseAmount,
            timestamp,
            serviceFee,
            licenseFee,
            "PRODUCT_ID_123"
          );
        
        const creditAccountTx = await phiPayLicensable
        .connect(operator)
        .creditAccount(
          await merchant.getAddress(),
          await mockUSDC.getAddress(),
        );
        await creditAccountTx.wait();
        const serviceFeeBalance = await phiPayLicensable.serviceFeeBalance(await mockUSDC.getAddress());
        expect(serviceFeeBalance).to.equal(serviceFee);
        
      const withdrawServiceFeesTx = await phiPayLicensable
        .connect(operator)
        .withdrawServiceFees(await mockUSDC.getAddress());
      await withdrawServiceFeesTx.wait(); 
      
      const withdrawLicenseFeesTx = await phiPayLicensable
        .connect(operator)
        .withdrawLicenseFees(await mockUSDC.getAddress());
      await withdrawLicenseFeesTx.wait();
      
      expect(
        await phiPayLicensable.getOptimisticTokenBalance(
          await mockUSDC.getAddress(),
          await customer.getAddress()
        )
      ).to.equal(await mockUSDC.balanceOf(await customer.getAddress()));
      expect(await mockUSDC.balanceOf(await phiPayLicensable.serviceFeeCollector())).to.equal(serviceFeeBalanceBefore + serviceFee);
      expect(await mockUSDC.balanceOf(await phiPayLicensable.licenseFeeCollector())).to.equal(licenseFeeBalanceBefore + licenseFee);
    });
  });
  describe("Forwarder transfers with Permit", function () {
    it("Should transfer Gld tokens using permit", async function () {
      const transferAmount = ethers.parseUnits("1", 6);

      // Calculate fees to determine total amount needed
      const [serviceFee, licenseFee] = await phiPayLicensable.calculateFees(
        transferAmount,
        false
      );
      const totalAmount = transferAmount + serviceFee + licenseFee;
      const { signature, deadline } = await getPermitSignature(
        gld as unknown as ERC20PermitToken,
        customer,
        await phiPayLicensable.getAddress(),
        totalAmount
      );
      const { v, r, s } = signature;
      const transferTx = await phiPayLicensable
      .connect(operator)
      .transferTokenWithPermit(
        await gld.getAddress(),
        await customer.getAddress(),
        await merchant.getAddress(),
        transferAmount,
        deadline,
        v,
        r,
        s,
        false, 
        true
      )
      await transferTx.wait();

      const timestamp = await ethers.provider
        .getBlock(transferTx.blockNumber!)
        .then((b) => b!.timestamp);

      await expect(
        transferTx
      )
        .to.emit(phiPayLicensable, "BalancesUpdated")
        .withArgs(
          await gld.getAddress(),
          await customer.getAddress(),
          await merchant.getAddress(),
          transferAmount,
          serviceFee,
          licenseFee,
          timestamp
        );

      const creditAccountTx = await phiPayLicensable
        .connect(operator)
        .creditAccount(
          await merchant.getAddress(),
          await gld.getAddress(),
        );
      await creditAccountTx.wait();

      expect(
        await phiPayLicensable.serviceFeeBalance(await gld.getAddress())
      ).to.equal(serviceFee);

      expect(
        await phiPayLicensable.licenseFeeBalance(await gld.getAddress())
      ).to.equal(licenseFee);

      const withdrawServiceFeesTx = await phiPayLicensable
        .connect(operator)
        .withdrawServiceFees(await gld.getAddress());
      await withdrawServiceFeesTx.wait();

      const withdrawLicenseFeesTx = await phiPayLicensable
        .connect(operator)
        .withdrawLicenseFees(await gld.getAddress());
      await withdrawLicenseFeesTx.wait();

      expect(
        await phiPayLicensable.serviceFeeBalance(await gld.getAddress())
      ).to.equal(0);
      expect(
        await phiPayLicensable.licenseFeeBalance(await gld.getAddress())
      ).to.equal(0);
      // Verify merchant received the payment (minus fees)
      expect(await gld.balanceOf(await merchant.getAddress())).to.equal(
        transferAmount
      );


      expect(
        await phiPayLicensable.getOptimisticTokenBalance(
          await gld.getAddress(),
          await merchant.getAddress()
        )
      ).to.equal(transferAmount);
    });

    it("Should reject expired permits", async function () {
      const transferAmount = ethers.parseUnits("1", 6);
      const expiredDeadline = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago

      // Calculate fees to determine total amount needed
      const [serviceFee, licenseFee] = await phiPayLicensable.calculateFees(
        transferAmount,
        false
      );
      const totalAmount = transferAmount + serviceFee + licenseFee;

      // Get permit signature
      const { signature, deadline } = await getPermitSignature(
        gld as unknown as ERC20PermitToken,
        customer,
        await phiPayLicensable.getAddress(),
        totalAmount,
        expiredDeadline
      );
      const { v, r, s } = signature;

      // Execute permit
      await expect(
        gld
          .connect(customer)
          .permit(
            await customer.getAddress(),
            await phiPayLicensable.getAddress(),
            totalAmount,
            deadline,
            v,
            r,
            s
          )
      ).to.be.revertedWithCustomError(gld, "ERC2612ExpiredSignature");
    });
  });

  describe("Fees", function () {
    it("Should correctly collect service fees", async function () {
      const transferAmount = ethers.parseUnits("1", 6);

      // Calculate fees to determine total amount needed
      const [serviceFee, licenseFee] = await phiPayLicensable.calculateFees(
        transferAmount,
        false
      );
      const totalAmount = transferAmount + serviceFee + licenseFee;
      const { signature, deadline } = await getPermitSignature(
        gld as unknown as ERC20PermitToken,
        customer,
        await phiPayLicensable.getAddress(),
        totalAmount
      );
      const { v, r, s } = signature;

      const initialServiceFeeCollectorBalance = await gld.balanceOf(
        await phiPayLicensable.serviceFeeCollector()
      );

      await phiPayLicensable
        .connect(operator)
        .transferTokenWithPermit(
          await gld.getAddress(),
          await customer.getAddress(),
          await merchant.getAddress(),
          transferAmount,
          deadline,
          v,
          r,
          s,
          false,
          true
        );

      expect(
        await phiPayLicensable.serviceFeeBalance(await gld.getAddress())
      ).to.equal(serviceFee);

      expect(
        await phiPayLicensable.getOptimisticTokenBalance(
          await gld.getAddress(),
          await customer.getAddress()
        )
      ).to.equal(
        (await gld.balanceOf(await customer.getAddress()))
      );

      await phiPayLicensable
        .connect(operator)
        .withdrawServiceFees(await gld.getAddress());

      // Verify fee distribution
      expect(
        await gld.balanceOf(await phiPayLicensable.serviceFeeCollector())
      ).to.equal(initialServiceFeeCollectorBalance + serviceFee);
    });

    it("Should not exceed max fees for PhiGold", async function () {
      const transferAmount = ethers.parseUnits("1000000000000000000", 6);
      const [serviceFee, licenseFee] = await phiPayLicensable.calculateFees(
        transferAmount,
        false
      );

      const totalAmount = transferAmount + serviceFee + licenseFee;

      expect(serviceFee).to.equal(await phiPayLicensable.maxGldFeeAmount());
      expect(licenseFee).to.equal(await phiPayLicensable.maxGldFeeAmount());
      expect(totalAmount).to.equal(transferAmount + serviceFee + licenseFee);
    });

    it("Should not exceed max fees for USD stablecoins", async function () {
      const transferAmount = ethers.parseUnits("1000000000000000000", 6);
      const [serviceFee, licenseFee] = await phiPayLicensable.calculateFees(
        transferAmount,
        true
      );

      const totalAmount = transferAmount + serviceFee + licenseFee  ;

      expect(serviceFee).to.equal(await phiPayLicensable.maxUsdFeeAmount());
      expect(licenseFee).to.equal(await phiPayLicensable.maxUsdFeeAmount());
      expect(totalAmount).to.equal(transferAmount + serviceFee + licenseFee);
    });
  });
});
