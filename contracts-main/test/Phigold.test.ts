import { ethers } from "hardhat";
import { Signer } from "ethers";
import { Gld } from "../src/types/contracts/Gld";
import { GldAuditRegistry } from "../src/types/contracts/GldAuditRegistry";
import { UsdcTest } from "../src/types/contracts/UsdcTest";
import {
  deployContract,
  ERC20PermitToken,
  getPermitSignature,
  validIPFSCIDv0,
  validIPFSCIDv1,
} from "./helpers";
import { expect } from "chai";

describe("Gld Contract", function () {
  let gld: Gld;
  let auditRegistry: GldAuditRegistry;
  let mockUSDC: UsdcTest;
  let owner: Signer;
  let user: Signer;

  const INITIAL_SUPPLY = ethers.parseUnits("1000000", 6);
  const INITIAL_USER_BALANCE = ethers.parseUnits("10000", 6);

  beforeEach(async function () {
    [owner, user] = await ethers.getSigners();

    auditRegistry = (await deployContract("GldAuditRegistry", [])) as unknown as GldAuditRegistry;
    gld = (await deployContract("Gld", [
      await auditRegistry.getAddress(),
    ])) as unknown as Gld;
    mockUSDC = (await deployContract("UsdcTest", [])) as unknown as UsdcTest;

    // Link Registry
    await auditRegistry.setGldContract(await gld.getAddress());

    // Initial setup - mint directly to contract
    const mintTx = await gld
      .connect(owner)
      .mintGldSupply(INITIAL_SUPPLY, validIPFSCIDv0);
    await mintTx.wait();

    // Mint USDC to user for testing swaps
    const mintUsdcTx = await mockUSDC
      .connect(owner)
      .mint(await user.getAddress(), INITIAL_USER_BALANCE);
    await mintUsdcTx.wait();
  });

  describe("Initialization", function () {
    it("Should set the right owner", async function () {
      expect(await gld.owner()).to.equal(await owner.getAddress());
    });

    it("Should have correct name and symbol", async function () {
      expect(await gld.name()).to.equal("Phinance.Gold");
      expect(await gld.symbol()).to.equal("GLD");
    });

    it("Should have correct decimals", async function () {
      expect(await gld.decimals()).to.equal(6);
    });
  });

  describe("Permit Implementation", function () {
    beforeEach(async function () {
      const amount = ethers.parseUnits("100", 6);
      expect(await gld.balanceOf(await gld.getAddress())).to.be.gte(
        amount
      );
    });

    it("Should implement DOMAIN_SEPARATOR correctly", async function () {
      const domain = {
        name: await gld.name(),
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await gld.getAddress(),
      };
      const domainSeparator = await gld.DOMAIN_SEPARATOR();
      const expectedDomainSeparator =
        ethers.TypedDataEncoder.hashDomain(domain);
      expect(domainSeparator).to.equal(expectedDomainSeparator);
    });

    it("Should allow spending with permit", async function () {
      const amount = ethers.parseUnits("100", 6);

      const { signature, deadline } = await getPermitSignature(
        gld as unknown as ERC20PermitToken,
        user,
        await gld.getAddress(),
        amount
      );
      const { v, r, s } = signature;

      await gld.permit(
        await user.getAddress(),
        await gld.getAddress(),
        amount,
        deadline,
        v,
        r,
        s
      );

      expect(
        await gld.allowance(
          await user.getAddress(),
          await gld.getAddress()
        )
      ).to.equal(amount);
    });

    it("Should reject expired permits", async function () {
      const amount = ethers.parseUnits("100", 6);

      const deadline = Math.floor(Date.now() / 1000) - 3600;
      const { signature } = await getPermitSignature(
        gld as unknown as ERC20PermitToken,
        user,
        await gld.getAddress(),
        amount,
        deadline
      );
      const { v, r, s } = signature;

      await expect(
        gld.permit(
          await user.getAddress(),
          await gld.getAddress(),
          amount,
          deadline,
          v,
          r,
          s
        )
      ).to.be.revertedWithCustomError(gld, "ERC2612ExpiredSignature");
    });
  });

  describe("Gld Swap and Redemption", function () {
    beforeEach(async function () {
      // Add USDC as supported token with 1:1 exchange rate
      const addTokenTx = await gld.addSupportedToken(
        await mockUSDC.getAddress(),
        ethers.parseUnits("70", 6)
      );
      await addTokenTx.wait();
    });

    it("Should calculate payment token amount correctly for different decimals (18)", async function () {
      const desiredGldAmount = ethers.parseUnits("1", 6);
      const Token18Dec = await ethers.getContractFactory(
        "VariableDecimalsMockToken"
      );
      const token18 = await Token18Dec.deploy(18);
      await token18.waitForDeployment();
      await gld.addSupportedToken(
        await token18.getAddress(),
        ethers.parseUnits("1", 18)
      );

      const token18Amount = await gld.calculatePaymentTokenForGld(
        await token18.getAddress(),
        desiredGldAmount,
        false
      );
      expect(token18Amount).to.equal(ethers.parseUnits("1", 18));
    });

    it("Should calculate payment token amount correctly for different decimals (4)", async function () {
      const desiredGldAmount = ethers.parseUnits("1", 6);
      const Token4Dec = await ethers.getContractFactory(
        "VariableDecimalsMockToken"
      );
      const token4 = await Token4Dec.deploy(4);
      await token4.waitForDeployment();
      await gld.addSupportedToken(
        await token4.getAddress(),
        ethers.parseUnits("2", 4)
      );

      const token4Amount = await gld.calculatePaymentTokenForGld(
        await token4.getAddress(),
        desiredGldAmount,
        false
      );
      // For 4 decimals token, we need to adjust by 2 decimal places (6 - 4)
      expect(token4Amount).to.equal(
        (2n * desiredGldAmount) / BigInt(10 ** 2)
      );
    });

    it("Should calculate gld token amount correctly when receiving a payment token with different decimals (4)", async function () {
      const desiredGldAmount = ethers.parseUnits("1", 6);
      const Token4Dec = await ethers.getContractFactory(
        "VariableDecimalsMockToken"
      );
      const token4 = await Token4Dec.deploy(4);
      await token4.waitForDeployment();
      await gld.addSupportedToken(
        await token4.getAddress(),
        ethers.parseUnits("2", 4)
      );

      const token4Amount = await gld.calculatePaymentTokenForGld(
        await token4.getAddress(),
        desiredGldAmount,
        false
      );
      // For 4 decimals token, we need to adjust by 2 decimal places (6 - 4)
      expect(token4Amount).to.equal(
        (2n * desiredGldAmount) / BigInt(10 ** 2)
      );
    });

    it("Should calculate gld token amount correctly when receiving a payment token with different decimals (18)", async function () {
      const paymentTokenAmount = ethers.parseUnits("4", 18);
      const Token18Dec = await ethers.getContractFactory(
        "VariableDecimalsMockToken"
      );
      const token18 = await Token18Dec.deploy(18);
      await token18.waitForDeployment();
      await gld.addSupportedToken(
        await token18.getAddress(),
        ethers.parseUnits("2", 18)
      );

      const gldAmount = await gld.calculateGldForPaymentToken(
        await token18.getAddress(),
        paymentTokenAmount,
        false
      );

      expect(gldAmount).to.equal(2000000n);
    });
    it("Should swap USDC for Gld", async function () {
      const desiredGldAmount = ethers.parseUnits("1", 6);
      const usdcAmount = await gld.calculatePaymentTokenForGld(
        await mockUSDC.getAddress(),
        desiredGldAmount,
        true
      );

      expect(await gld.balanceOf(await gld.getAddress())).to.be.gte(
        desiredGldAmount
      );
      expect(await mockUSDC.balanceOf(await user.getAddress())).to.be.gte(
        usdcAmount
      );

      // Approve USDC spending
      await mockUSDC
        .connect(user)
        .approve(await gld.getAddress(), usdcAmount);

      const swapTx = await gld
        .connect(user)
        .swapSupportedTokenForGld(
          await mockUSDC.getAddress(),
          usdcAmount,
          0, // minAmountOut
          true
        );
      const timestamp = await ethers.provider
        .getBlock(swapTx.blockNumber!)
        .then((b) => b!.timestamp);
      await expect(swapTx)
        .to.emit(gld, "SwapCompleted")
        .withArgs(
          await user.getAddress(),
          await mockUSDC.getAddress(),
          usdcAmount,
          desiredGldAmount,
          timestamp
        );

      // Verify final balances
      expect(await gld.balanceOf(await user.getAddress())).to.equal(
        desiredGldAmount
      );
      expect(await mockUSDC.balanceOf(await user.getAddress())).to.equal(
        INITIAL_USER_BALANCE - usdcAmount
      );
    });

    it("Should handle permit-based swaps correctly when called by trusted forwarder", async function () {
      const desiredGldAmount = ethers.parseUnits("1", 6);
      const usdcAmount = await gld.calculatePaymentTokenForGld(
        await mockUSDC.getAddress(),
        desiredGldAmount,
        true
      );

      // Verify initial balances
      expect(await gld.balanceOf(await gld.getAddress())).to.be.gte(
        desiredGldAmount
      );
      expect(await mockUSDC.balanceOf(await user.getAddress())).to.be.gte(
        usdcAmount
      );

      const { signature, deadline } = await getPermitSignature(
        mockUSDC as unknown as ERC20PermitToken,
        user,
        await gld.getAddress(),
        usdcAmount
      );
      const { v, r, s } = signature;

      const swapTx = await gld
        .connect(owner)
        .swapSupportedTokenForGldWithPermit(
          await user.getAddress(),
          await mockUSDC.getAddress(),
          usdcAmount,
          0, // minAmountOut
          deadline,
          v,
          r,
          s,
          true
        );
      const timestamp = await ethers.provider
        .getBlock(swapTx.blockNumber!)
        .then((b) => b!.timestamp);
      await expect(swapTx)
        .to.emit(gld, "SwapCompleted")
        .withArgs(
          await user.getAddress(),
          await mockUSDC.getAddress(),
          usdcAmount,
          desiredGldAmount,
          timestamp
        );

      // Verify final balances
      expect(await gld.balanceOf(await user.getAddress())).to.equal(
        desiredGldAmount
      );
      expect(await mockUSDC.balanceOf(await user.getAddress())).to.equal(
        INITIAL_USER_BALANCE - usdcAmount
      );
    });
    it("Should revert if slippage tolerance is exceeded", async function () {
      const desiredGldAmount = ethers.parseUnits("1", 6);
      const usdcAmount = await gld.calculatePaymentTokenForGld(
        await mockUSDC.getAddress(),
        desiredGldAmount,
        true
      );

      await mockUSDC
        .connect(user)
        .approve(await gld.getAddress(), usdcAmount);

      // Expect 1.1 GLD but only getting 1.0 -> Should revert
      const minAmountOut = ethers.parseUnits("1.1", 6); 

      await expect(
        gld
          .connect(user)
          .swapSupportedTokenForGld(
            await mockUSDC.getAddress(),
            usdcAmount,
            minAmountOut,
            true
          )
      ).to.be.revertedWith("Slippage tolerance exceeded");
    });
  });

  describe("Minting with IPFS", function () {
    it("Should mint tokens with valid CIDv0", async function () {
      const amount = ethers.parseUnits("1000", 6);
      const tx = await gld.mintGldSupply(amount, validIPFSCIDv0);
      const receipt = await tx.wait();

      expect(receipt?.logs[0].topics[0]).to.equal(
        ethers.id("Transfer(address,address,uint256)")
      );
      const lastId = (await gld.lastMintId()) - 1n;
      expect(await auditRegistry.getAuditReport(lastId)).to.equal(validIPFSCIDv0);
    });

    it("Should mint tokens with valid CIDv1", async function () {
      const amount = ethers.parseUnits("1000", 6);
      await gld.mintGldSupply(amount, validIPFSCIDv1);
      const lastId = (await gld.lastMintId()) - 1n;
      expect(await auditRegistry.getAuditReport(lastId)).to.equal(validIPFSCIDv1);
    });

    // Removed "Should reject minting with invalid IPFS CID" as format validation was removed.

    it("Should reject minting with empty IPFS link", async function () {
      const amount = ethers.parseUnits("1000", 6);
      await expect(gld.mintGldSupply(amount, "")).to.be.revertedWith(
        "Audit report IPFS link must be provided"
      );
    });

    it("Should store audit report link in registry", async function () {
      const amount = ethers.parseUnits("1000", 6);
      await gld.mintGldSupply(amount, validIPFSCIDv0);
      const lastId = (await gld.lastMintId()) - 1n;
      expect(await auditRegistry.getAuditReport(lastId)).to.equal(validIPFSCIDv0);
    });
  });

  describe("Additional Functionality", function () {
    it("Should handle pausing correctly", async function () {
      await gld.connect(owner).pause();
      expect(await gld.paused()).to.be.true;

      const amount = ethers.parseUnits("100", 6);
      await expect(
        gld.connect(user).transfer(await gld.getAddress(), amount)
      ).to.be.revertedWithCustomError(gld, "EnforcedPause");

      await gld.unpause();
      expect(await gld.paused()).to.be.false;
    });

    it("Should allow emergency token withdrawal", async function () {
      const amount = ethers.parseUnits("100", 6);
      await mockUSDC.mint(await gld.getAddress(), amount);

      await expect(
        gld.withdrawERC20Token(await mockUSDC.getAddress())
      ).to.changeTokenBalances(mockUSDC, [gld, owner], [-amount, amount]);
    });

    it("Should manage token exchange rates correctly", async function () {
      await gld.addSupportedToken(
        await mockUSDC.getAddress(),
        ethers.parseUnits("70", 6)
      );
      const newRate = ethers.parseUnits("2", 6);
      await gld.setPaymentTokenExchangeRate(
        await mockUSDC.getAddress(),
        newRate
      );
      expect(
        await gld.getTokenExchangeRate(await mockUSDC.getAddress())
      ).to.equal(newRate);
    });

    it("Should update USD price correctly", async function () {
      const newPrice = 75000000n;
      await gld.setUsdExchangeRate(newPrice);
      expect(await gld.getUsdExchangeRate()).to.equal(newPrice);
    });
  });

  describe("Token Management", function () {
    it("Should not allow adding token with zero exchange rate", async function () {
      await expect(
        gld.addSupportedToken(await mockUSDC.getAddress(), 0)
      ).to.be.revertedWith("Exchange Rate must be greater than 0");
    });

    it("Should not allow adding zero address as token", async function () {
      await expect(
        gld.addSupportedToken(ethers.ZeroAddress, ethers.parseUnits("1", 6))
      ).to.be.revertedWith("Token address must be provided");
    });

    it("Should not allow adding non-ERC20Permit token", async function () {
      const NonPermitToken = await ethers.getContractFactory(
        "MockNonPermitToken"
      );
      const nonPermitToken = await NonPermitToken.deploy();
      await expect(
        gld.addSupportedToken(
          await nonPermitToken.getAddress(),
          ethers.parseUnits("1", 6)
        )
      ).to.be.revertedWith("Token must implement ERC20Permit");
    });

    it("Should not allow removing zero address as token", async function () {
      await expect(
        gld.removeSupportedToken(ethers.ZeroAddress)
      ).to.be.revertedWith("Token address must be provided");
    });

    it("Should not allow removing non-existent token", async function () {
      await expect(
        gld.removeSupportedToken(await mockUSDC.getAddress())
      ).to.be.revertedWith("Token not found");
    });

    it("Should correctly track supported token count", async function () {
      const initialCount = await gld.supportedTokenCount();
      await gld.addSupportedToken(
        await mockUSDC.getAddress(),
        ethers.parseUnits("1", 6)
      );
      expect(await gld.supportedTokenCount()).to.equal(initialCount + 1n);
      await gld.removeSupportedToken(await mockUSDC.getAddress());
      expect(await gld.supportedTokenCount()).to.equal(initialCount);
    });

    it("Should emit events when adding and removing tokens", async function () {
      await expect(
        gld.addSupportedToken(
          await mockUSDC.getAddress(),
          ethers.parseUnits("1", 6)
        )
      )
        .to.emit(gld, "TokenAdded")
        .withArgs(await mockUSDC.getAddress(), ethers.parseUnits("1", 6));

      await expect(gld.removeSupportedToken(await mockUSDC.getAddress()))
        .to.emit(gld, "TokenRemoved")
        .withArgs(await mockUSDC.getAddress());
    });
  });

  describe("Token Withdrawal", function () {
    it("Should not allow withdrawing zero address token", async function () {
      await expect(
        gld.withdrawERC20Token(ethers.ZeroAddress)
      ).to.be.revertedWith("Token address must be provided");
    });

    it("Should not allow withdrawing GLD token", async function () {
      await expect(
        gld.withdrawERC20Token(await gld.getAddress())
      ).to.be.revertedWith("Cannot withdraw GLD");
    });

    it("Should not allow withdrawing when balance is zero", async function () {
      await expect(
        gld.withdrawERC20Token(await mockUSDC.getAddress())
      ).to.be.revertedWith("Insufficient payment token balance");
    });
  });
  describe("Gld Redemption", function () {
    beforeEach(async function () {
      // Add USDC as supported token with 1:1 exchange rate
      const addTokenTx = await gld.addSupportedToken(
        await mockUSDC.getAddress(),
        ethers.parseUnits("70", 6)
      );
      await addTokenTx.wait();
      const usdcAmount = await gld.calculatePaymentTokenForGld(
        await mockUSDC.getAddress(),
        ethers.parseUnits("7", 6),
        true
      );
      await mockUSDC
        .connect(user)
        .approve(await gld.getAddress(), usdcAmount);
      await gld
        .connect(user)
        .swapSupportedTokenForGld(
          await mockUSDC.getAddress(),
          usdcAmount,
          0, // minAmountOut
          true
        );
    });

    it("Should not allow redeeming amounts not divisible by 5", async function () {
      await expect(
        gld
          .connect(user)
          .redeemGld(ethers.parseUnits("7", 6), "ORDER123")
      ).to.be.revertedWith(
        "Gld amount must be divisible by 5 GLD units"
      );
    });

    it("Should not allow redeeming with empty purchase ID", async function () {
      await expect(
        gld.connect(user).redeemGld(ethers.parseUnits("5", 6), "")
      ).to.be.revertedWith("Purchase ID must be provided");
    });

    it("Should emit BurnEvent on successful redemption", async function () {
      const desiredGldAmount = ethers.parseUnits("5", 6);
      const redeemTx = await gld
        .connect(user)
        .redeemGld(desiredGldAmount, "5");
      await redeemTx.wait();
      const timestamp = await ethers.provider
        .getBlock(redeemTx.blockNumber!)
        .then((b) => b!.timestamp);

      await expect(redeemTx)
        .to.emit(gld, "BurnEvent")
        .withArgs(
          await user.getAddress(),
          desiredGldAmount,
          timestamp,
          "Gld Redeemed: 5"
        );
    });

    it("Should not allow redeeming more than balance", async function () {
      await expect(
        gld
          .connect(user)
          .redeemGld(ethers.parseUnits("1000", 6), "ORDER123")
      ).to.be.revertedWith("Insufficient GLD balance");
    });
  });
});
