// SPDX-License-Identifier: UNLICENSED
/*
 * Copyright (c) 2025 PhinanceGold
 * All rights reserved.
 *
 * This contract is proprietary and confidential. Unauthorized copying,
 * distribution, modification, or use is strictly prohibited without
 * express written permission from PhinanceGold
 */
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

interface IOmegapayComplianceRegistry {
    function isKYCValid(address user) external view returns (bool);
    function isBlacklisted(address user) external view returns (bool);
    function kycExpiration(address user) external view returns (uint256);
    function getTimeUntilKycExpiration(address user) external view returns (uint256);
}

/**
 * PhiPay
 * - Immediate split transfer (recipient + fee collectors)
 * - KYC/Blacklist enforced gas sponsorship via external ComplianceRegistry
 * - Whitelisted ERC20s with stored decimals and min amounts
 */
contract PhiPayCore is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ===== Fees =====
    uint256 public constant BASIS_POINTS = 10_000;
    uint256 public serviceFeeBps = 200; // 2% starting default
    address public serviceFeeCollector;

    // ===== External registries =====
    IOmegapayComplianceRegistry public complianceRegistry;

    // ===== Tokens =====
    struct TokenInfo {
        IERC20 token;
        uint8 decimals;
        uint256 minTransferAmount; // in token's smallest unit
        uint256 maxNonVerifiedTransferAmount; // in token's smallest unit
        uint256 maxServiceFee; // token units (0 => no cap)
    }
    mapping(address => TokenInfo) public tokenInfo;
    mapping(address => uint256) public serviceFeeBalance; //  accumulated service fees for each token

    // ===== Events =====
    event ComplianceRegistryUpdated(
        address indexed oldRegistry,
        address indexed newRegistry
    );
    event ServiceFeeCollectorUpdated(
        address indexed oldCollector,
        address indexed newCollector
    );
    event ServiceFeeBpsUpdated(uint256 oldBps, uint256 newBps);
    event TransferWithFees(
        address indexed token,
        address indexed from,
        address indexed to,
        uint256 amount, 
        uint256 recipientNet,
        uint256 serviceFee,
        uint256 timestamp
    );
    event ServiceFeesWithdrawn(
        address indexed token,
        address indexed collector,
        uint256 amount,
        uint256 timestamp
    );
    event TokenFeeCapsUpdated(address indexed token, uint256 maxServiceFee);
    event TokenUpdated(
        address indexed token,
        uint256 minTransferAmount,
        uint256 maxNonVerifiedTransferAmount,
        uint256 maxServiceFee
    );

    constructor(
        address _kycRegistry
    ) Ownable(msg.sender) {
        require(_kycRegistry != address(0), "KYC registry required");
        complianceRegistry = IOmegapayComplianceRegistry(_kycRegistry);
        serviceFeeCollector = msg.sender;
    }

    // ===== Admin =====
    function setComplianceRegistry(
        address _complianceRegistry
    ) external onlyOwner {
        require(
            _complianceRegistry != address(0),
            "invalid compliance registry"
        );
        emit ComplianceRegistryUpdated(
            address(complianceRegistry),
            _complianceRegistry
        );
        complianceRegistry = IOmegapayComplianceRegistry(_complianceRegistry);
    }

    function setServiceFeeCollector(
        address newServiceFeeCollector
    ) external onlyOwner {
        require(newServiceFeeCollector != address(0), "invalid addr");
        require(
            newServiceFeeCollector != address(this),
            "cannot be the contract itself"
        );
        emit ServiceFeeCollectorUpdated(
            serviceFeeCollector,
            newServiceFeeCollector
        );
        serviceFeeCollector = newServiceFeeCollector;
    }

    function setServiceFeeBps(uint256 bps) external onlyOwner {
        require(bps <= 1_000, "service fee too high"); // <=10%
        emit ServiceFeeBpsUpdated(serviceFeeBps, bps);
        serviceFeeBps = bps;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ===== Tokens =====
    function addSupportedToken(
        address token,
        uint256 minTransferAmount,
        uint256 maxNonVerifiedTransferAmount,
        uint256 maxServiceFee
    ) external onlyOwner {
        require(token != address(0), "token required");
        require(address(tokenInfo[token].token) == address(0), "exists");
        uint8 dec = IERC20Metadata(token).decimals();
        tokenInfo[token] = TokenInfo({
            token: IERC20(token),
            decimals: dec,
            maxNonVerifiedTransferAmount: maxNonVerifiedTransferAmount,
            minTransferAmount: minTransferAmount,
            maxServiceFee: maxServiceFee
        });
        emit TokenUpdated(
            token,
            minTransferAmount,
            maxNonVerifiedTransferAmount,
            maxServiceFee
        );
    }

    function setTokenParams(
        address token,
        uint256 minTransferAmount,
        uint256 maxNonVerifiedTransferAmount,
        uint256 maxServiceFee
    ) external onlyOwner {
        require(
            address(tokenInfo[token].token) != address(0),
            "no token found"
        );
        tokenInfo[token].minTransferAmount = minTransferAmount;
        tokenInfo[token].maxServiceFee = maxServiceFee;
        tokenInfo[token].maxNonVerifiedTransferAmount = maxNonVerifiedTransferAmount;
        emit TokenUpdated(token, minTransferAmount, maxNonVerifiedTransferAmount, maxServiceFee);
    }

    /// @notice Set per-token absolute fee caps in token units (0 disables the cap)
    function setTokenFeeCaps(
        address token,
        uint256 maxServiceFee
    ) external onlyOwner {
        require(
            address(tokenInfo[token].token) != address(0),
            "no token found"
        );
        tokenInfo[token].maxServiceFee = maxServiceFee;

        emit TokenFeeCapsUpdated(token, maxServiceFee);
    }

    // ===== Views =====
    function isVerified(address user) public view returns (bool) {
        return
            complianceRegistry.isKYCValid(user) &&
            !complianceRegistry.isBlacklisted(user);
    }

    function isBlacklisted(address user) public view returns (bool) {
        return complianceRegistry.isBlacklisted(user);
    }

    function calculateFee(
        address token,
        uint256 amount /* token units */
    ) public view returns (uint256 serviceFee) {
        TokenInfo memory ti = tokenInfo[token];
        serviceFee = (amount * serviceFeeBps) / BASIS_POINTS;
        if (ti.maxServiceFee != 0 && serviceFee > ti.maxServiceFee) {
            serviceFee = ti.maxServiceFee;
        }
    }

    // ===== Transfers =====
    // senderPaysFee = true  => recipient gets 'amount', sender pays amount+fees
    // senderPaysFee = false => sender pays 'amount', recipient gets (amount - fees)
    function transferWithFeeFrom(
        address token,
        address recipient,
        uint256 amount,
        bool senderPaysFee
    ) external whenNotPaused nonReentrant returns (bool) {
        _preChecks(token, msg.sender, recipient, amount);

        uint256 serviceFee = calculateFee(token, amount);
        uint256 totalDebit = senderPaysFee ? amount + serviceFee : amount;
        uint256 recipientNet = senderPaysFee ? amount : amount - serviceFee;

        require(recipientNet > 0, "net <= 0");

        _pullAndDistribute(
            token,
            msg.sender,
            recipient,
            totalDebit,
            recipientNet,
            serviceFee
        );
        return true;
    }

    function getContractTokenBalance(
        address token
    ) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    function getServiceFeeBalance(
        address token
    ) external view returns (uint256) {
        return serviceFeeBalance[token];
    }

    function withdrawServiceFees(address token) external nonReentrant {
        require(msg.sender == serviceFeeCollector, "only fee collector");
        uint256 balance = serviceFeeBalance[token];
        require(balance > 0, "no fees to withdraw");

        serviceFeeBalance[token] = 0;
        IERC20(token).safeTransfer(serviceFeeCollector, balance);

        emit ServiceFeesWithdrawn(
            token,
            serviceFeeCollector,
            balance,
            block.timestamp
        );
    }

    // ===== Internals =====
    function _preChecks(
        address token,
        address sender,
        address recipient,
        uint256 amount
    ) internal view {
        require(recipient != address(0), "recipient required");
        require(!isBlacklisted(recipient), "recipient is blacklisted");
        TokenInfo memory ti = tokenInfo[token];
        require(amount >= ti.minTransferAmount, "below min transfer amount");
        require(address(ti.token) != address(0), "unsupported token");
        if (!isVerified(sender)) {
            require(
                amount <= ti.maxNonVerifiedTransferAmount,
                "above max non verified transfer amount"
            );
        }
    }

    function _pullAndDistribute(
        address token,
        address from,
        address to,
        uint256 totalDebit,
        uint256 recipientNet,
        uint256 serviceFee
    ) internal {
        IERC20 t = IERC20(token);
        // Pull total from sender
        t.safeTransferFrom(from, address(this), totalDebit);

        // Immediate payout to recipient
        if (recipientNet > 0) {
            t.safeTransfer(to, recipientNet);
        }

        // Accumulate fees in contract for later withdrawal
        if (serviceFee > 0) {
            serviceFeeBalance[token] += serviceFee;
        }

        emit TransferWithFees(
            token,
            from,
            to,
            totalDebit,
            recipientNet,
            serviceFee,
            block.timestamp
        );
    }
}
