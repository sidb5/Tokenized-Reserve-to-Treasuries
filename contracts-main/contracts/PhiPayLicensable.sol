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
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

contract PhiPayLicensable is Ownable, Pausable, ReentrancyGuard {
    uint256 public SERVICE_FEE_BASIS_POINTS = 100; // 1%
    uint256 public LICENSE_FEE_BASIS_POINTS = 100; // 1% 
    uint256 public constant BASIS_POINTS = 10000;
    uint256 public maxUsdFeeAmount = 2500000; // 2.5 USDC (6 decimals)
    uint256 public maxGldFeeAmount = 100000; // .1 GLD (6 decimals)
    address public serviceFeeCollector;
    address public licenseFeeCollector;
    // Constants for unverified user limits (in USDC with 6 decimals)
    uint256 public constant DAILY_LIMIT = 500000000; // 500 USDC
    uint256 public constant YEARLY_LIMIT = 10000000000; // 10000 USDC
    uint256 public constant KYC_VALIDITY_PERIOD = 365 days; // 1 year validity for KYC

    struct TokenInfo {
        IERC20 token;
        uint8 decimals;
        bool isSupported;
        uint256 minTransferAmount;
    }

    mapping(address => TokenInfo) public tokenInfo;
    mapping(address => uint256) public serviceFeeBalance;
    mapping(address => uint256) public licenseFeeBalance;
    mapping(address => mapping(address => uint256)) public pendingCreditAmount;
    mapping(address => bool) public isBlacklisted;
    // Pack daily and yearly amounts into a single uint256 to save gas
    // First 128 bits: daily amount
    // Last 128 bits: yearly amount
    mapping(address => uint256) public userTransferLimits;
    mapping(address => uint256) public lastTransferTimestamp;
    uint256 public supportedTokenCount;

    // Store expiration timestamp directly instead of verification timestamp
    mapping(address => uint256) public kycExpiration;

    event TokenAdded(address indexed token, uint8 decimals);
    event TokenArchived(address indexed token);
    event ServiceFeeBasisPointsUpdated(uint256 serviceFee);
    event LicenseFeeBasisPointsUpdated(uint256 licenseFee);
    event ServiceFeeCollected(
        address indexed tokenAddress,
        address indexed senderAddress,
        uint256 amount
    );
    event TransferWithFees(
        address indexed tokenAddress,
        address indexed from,
        address indexed to,
        uint256 amount,
        uint256 serviceFee,
        uint256 licenseFee,
        uint256 timestamp
    );
    event PurchaseCompleted(
        address indexed tokenAddress,
        address indexed from,
        address indexed to,
        uint256 amount,
        uint256 timestamp,
        uint256 serviceFee,
        uint256 licenseFee,
        string productId
    );
    event MinTransferAmountUpdated(uint256 oldAmount, uint256 newAmount);
    event MaxTransferAmountUpdated(uint256 oldAmount, uint256 newAmount);
    event MaxUsdFeeAmountUpdated(uint256 oldAmount, uint256 newAmount);
    event ServiceFeeCollectorUpdated(
        address indexed oldCollector,
        address indexed newCollector
    );
    event KYCVerified(address indexed userAddress, uint256 expirationTimestamp);
    event KYCExpired(address indexed userAddress, uint256 expirationTimestamp);
    event Blacklisted(address indexed userAddress);
    event MaxGldFeeAmountUpdated(uint256 oldAmount, uint256 newAmount);
    event BalancesUpdated(
        address indexed tokenAddress,
        address indexed senderAddress,
        address indexed recipientAddress,
        uint256 amount,
        uint256 serviceFee,
        uint256 licenseFee,
        uint256 timestamp
    );
    event TransferLimitUpdated(
        address indexed user,
        uint256 dailyAmount,
        uint256 yearlyAmount
    );

    constructor(address _serviceFeeCollector) Ownable(msg.sender) {
        serviceFeeCollector = _serviceFeeCollector;
        licenseFeeCollector = msg.sender;
    }

    modifier onlySupportedToken(address tokenAddress) {
        require(
            tokenInfo[tokenAddress].token != IERC20(address(0)),
            "Must provide a valid token address"
        );
        require(tokenInfo[tokenAddress].isSupported, "Token not supported");
        _;
    }

    modifier onlyVerifiedUser(address userAddress) {
        require(!isBlacklisted[userAddress], "User is blacklisted");
        require(isKYCValid(userAddress), "User KYC expired or not verified");
        _;
    }

    modifier validTransferAmount(uint256 amount, address tokenAddress) {
        require(
            amount >= tokenInfo[tokenAddress].minTransferAmount,
            "Amount below minimum"
        );
        _;
    }

    function setBlacklisted(address _userAddress, bool _isBlacklisted) external onlyOwner {
        isBlacklisted[_userAddress] = _isBlacklisted;
    }

    function setKYCVerified(address _userAddress, bool _isKYCVerified) external onlyOwner {
        if (_isKYCVerified) {
            kycExpiration[_userAddress] = block.timestamp + KYC_VALIDITY_PERIOD;
            emit KYCVerified(_userAddress, kycExpiration[_userAddress]);
        } else {
            kycExpiration[_userAddress] = 0;
            emit KYCExpired(_userAddress, block.timestamp);
        }
    }

    function setServiceFeeCollector(
        address newServiceFeeCollector
    ) external onlyOwner {
        require(
            newServiceFeeCollector != address(0),
            "Invalid service fee collector address"
        );
        serviceFeeCollector = newServiceFeeCollector;
        emit ServiceFeeCollectorUpdated(
            serviceFeeCollector,
            newServiceFeeCollector
        );
    }

    function setMaxUsdFeeAmount(uint256 newAmount) external onlyOwner {
        require(newAmount > 0, "Invalid max fee amount");
        uint256 oldAmount = maxUsdFeeAmount;
        maxUsdFeeAmount = newAmount;
        emit MaxUsdFeeAmountUpdated(oldAmount, newAmount);
    }

    function setMaxGldFeeAmount(uint256 newAmount) external onlyOwner {
        require(newAmount > 0, "Invalid max fee amount");
        uint256 oldAmount = maxGldFeeAmount;
        maxGldFeeAmount = newAmount;
        emit MaxGldFeeAmountUpdated(oldAmount, newAmount);
    }

    function setServiceFeeBasisPoints(uint256 serviceFee) external onlyOwner {
        require(serviceFee <= 1000, "Total fees cannot exceed 10%");
        SERVICE_FEE_BASIS_POINTS = serviceFee;
        emit ServiceFeeBasisPointsUpdated(serviceFee);
    }  
    
    function setLicenseFeeBasisPoints(uint256 licenseFee) external onlyOwner {
        require(licenseFee <= 1000, "Total fees cannot exceed 10%");
        LICENSE_FEE_BASIS_POINTS = licenseFee;
        emit LicenseFeeBasisPointsUpdated(licenseFee);
    }

    function addSupportedTokenWithParams(
        address _tokenAddress,
        uint256 _minTransferAmount
    ) public onlyOwner {
        require(_tokenAddress != address(0), "Token address must be provided");
        require(
            tokenInfo[_tokenAddress].token == IERC20(address(0)),
            "Token already exists"
        );

        try IERC20Metadata(_tokenAddress).decimals() returns (uint8 decimals) {
            try IERC20Permit(_tokenAddress).DOMAIN_SEPARATOR() returns (
                bytes32
            ) {
                tokenInfo[_tokenAddress] = TokenInfo(
                    IERC20(_tokenAddress),
                    decimals,
                    true,
                    _minTransferAmount
                );
                supportedTokenCount++;
                emit TokenAdded(_tokenAddress, decimals);
            } catch {
                revert("Token must implement ERC20Permit");
            }
        } catch {
            revert("No token decimals found");
        }
    }

    function addSupportedToken(address _tokenAddress) public onlyOwner {
        addSupportedTokenWithParams(_tokenAddress, 1000);
    }

    function archiveSupportedToken(address _tokenAddress) public onlyOwner {
        require(_tokenAddress != address(0), "Token address must be provided");
        require(tokenInfo[_tokenAddress].isSupported, "Token not found");
        tokenInfo[_tokenAddress].isSupported = false;
        supportedTokenCount--;
        emit TokenArchived(_tokenAddress);
    }

    function getTokenInfo(
        address _tokenAddress
    ) public view returns (TokenInfo memory) {
        return tokenInfo[_tokenAddress];
    }

    function calculateFees(
        uint256 amount,
        bool isUsd
    ) public view returns (uint256 serviceFee, uint256 licenseFee) {
        serviceFee = (SERVICE_FEE_BASIS_POINTS * amount) / BASIS_POINTS;
        licenseFee = (LICENSE_FEE_BASIS_POINTS * amount) / BASIS_POINTS;
        uint256 maxFeeAmount = isUsd ? maxUsdFeeAmount : maxGldFeeAmount;

        if (serviceFee > maxFeeAmount) {
            serviceFee = maxFeeAmount;
        }

        if (licenseFee > maxFeeAmount) {
            licenseFee = maxFeeAmount;
        }   

        return (serviceFee, licenseFee);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function setMinTransferAmount(
        uint256 newAmount,
        address tokenAddress
    ) external onlyOwner {
        require(newAmount > 0, "Invalid min amount");
        uint256 oldAmount = tokenInfo[tokenAddress].minTransferAmount;
        tokenInfo[tokenAddress].minTransferAmount = newAmount;
        emit MinTransferAmountUpdated(oldAmount, newAmount);
    }

    function getOptimisticTokenBalance(
        address tokenAddress,
        address userAddress
    ) public view returns (uint256) {
        return
            tokenInfo[tokenAddress].token.balanceOf(userAddress) +
            pendingCreditAmount[userAddress][tokenAddress];
    }

    function updateServiceFeeCollector(
        address newServiceFeeCollector
    ) external onlyOwner {
        require(
            newServiceFeeCollector != address(0),
            "Invalid service fee collector"
        );
        address oldServiceFeeCollector = serviceFeeCollector;
        serviceFeeCollector = newServiceFeeCollector;
        emit ServiceFeeCollectorUpdated(
            oldServiceFeeCollector,
            newServiceFeeCollector
        );
    }

    function creditAccount(
        address recipientAddress,
        address tokenAddress
    ) public nonReentrant {
        uint256 pendingCreditBalance = pendingCreditAmount[recipientAddress][
            tokenAddress
        ];
        require(pendingCreditBalance > 0, "No balance to distribute");
        require(
            IERC20(tokenAddress).transfer(
                recipientAddress,
                pendingCreditBalance
            ),
            "Pending credit transfer amount transfer failed"
        );
        pendingCreditAmount[recipientAddress][tokenAddress] = 0;
    }

    function withdrawServiceFees(address tokenAddress) public nonReentrant {
        uint256 feeBalance = serviceFeeBalance[tokenAddress];
        require(
            IERC20(tokenAddress).transfer(serviceFeeCollector, feeBalance),
            "Service fee transfer failed"
        );
        serviceFeeBalance[tokenAddress] = 0;
    }

    function withdrawLicenseFees(address tokenAddress) public nonReentrant {
        uint256 feeBalance = licenseFeeBalance[tokenAddress];
        require(
            IERC20(tokenAddress).transfer(licenseFeeCollector, feeBalance),
            "License fee transfer failed"
        );
        licenseFeeBalance[tokenAddress] = 0;
    }

    // Helper function to pack/unpack amounts
    function _packAmounts(uint256 daily, uint256 yearly) internal pure returns (uint256) {
        return (daily << 128) | yearly;
    }

    function _unpackAmounts(uint256 packed) internal pure returns (uint256 daily, uint256 yearly) {
        daily = packed >> 128;
        yearly = packed & type(uint128).max;
    }

    // Function to check and update transfer limits
    function _checkAndUpdateTransferLimits(
        address user,
        uint256 amount
    ) private returns (bool) {
        if (isKYCValid(user)) {
            return true;
        }

        uint256 currentTimestamp = block.timestamp;
        uint256 lastTimestamp = lastTransferTimestamp[user];
        uint256 packedLimits = userTransferLimits[user];
        (uint256 dailyAmount, uint256 yearlyAmount) = _unpackAmounts(packedLimits);

        // Reset daily limit if it's a new day
        if (currentTimestamp / 1 days > lastTimestamp / 1 days) {
            dailyAmount = 0;
        }

        // Reset yearly limit if it's a new year
        if (currentTimestamp / 365 days > lastTimestamp / 365 days) {
            yearlyAmount = 0;
        }

        // Check limits
        require(dailyAmount + amount <= DAILY_LIMIT, "Daily transfer limit exceeded");
        require(yearlyAmount + amount <= YEARLY_LIMIT, "Yearly transfer limit exceeded");

        // Update amounts
        dailyAmount += amount;
        yearlyAmount += amount;

        // Update storage
        userTransferLimits[user] = _packAmounts(dailyAmount, yearlyAmount);
        lastTransferTimestamp[user] = currentTimestamp;

        emit TransferLimitUpdated(user, dailyAmount, yearlyAmount);
        return true;
    }

    // Update the _adjustBalances function to include limit checks
    function _adjustBalances(
        address tokenAddress,
        address senderAddress,
        address recipientAddress,
        uint256 amount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s,
        bool isUsd,
        bool senderPaysFee
    ) private nonReentrant returns (bool) {
        // Add transfer limit check (only for USDC)
        if (isUsd) {
            require(
                _checkAndUpdateTransferLimits(senderAddress, amount),
                "Transfer limit check failed"
            );
        }

        (uint256 serviceFee, uint256 licenseFee) = calculateFees(amount, isUsd); 
        require(
            senderPaysFee || amount > (serviceFee + licenseFee),
            "Total fees exceed transfer amount"
        );
        // Calculate total amount based on who pays the fees
        uint256 totalAmount = senderPaysFee 
            ? amount + serviceFee + licenseFee  // Sender pays amount + both fees
            : amount;                           // Recipient's amount will be reduced by fees later

        IERC20Permit(tokenAddress).permit(
            senderAddress,
            address(this),
            totalAmount,
            deadline,
            v,
            r,
            s
        );

        require(
            IERC20(tokenAddress).transferFrom(
                senderAddress,
                address(this),
                totalAmount
            ),
            "Transfer failed"
        );

        // Update pending credit amounts
        uint256 recipientCredit;
        if (senderPaysFee) {
            recipientCredit = amount;
        } else {
            recipientCredit = amount - serviceFee - licenseFee;
        }

        pendingCreditAmount[recipientAddress][tokenAddress] += recipientCredit;    
        serviceFeeBalance[tokenAddress] += serviceFee;
        licenseFeeBalance[tokenAddress] += licenseFee;

        emit BalancesUpdated(
            tokenAddress,
            senderAddress,
            recipientAddress,
            amount,
            serviceFee,
            licenseFee,
            block.timestamp
        );

        return true;
    }

    function transferTokenWithPermit(
        address tokenAddress,
        address senderAddress,
        address recipientAddress,
        uint256 amount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s,
        bool isUsd,
        bool senderPaysFee
    )
        public
        onlySupportedToken(tokenAddress)
        validTransferAmount(amount, tokenAddress)
        whenNotPaused
        returns (bool)
    {
        return _adjustBalances(
            tokenAddress,
            senderAddress,
            recipientAddress,
            amount,
            deadline,
            v,
            r,
            s,
            isUsd,
            senderPaysFee
        );
    }

    function makePurchase(
        address tokenAddress,
        address senderAddress,
        address recipientAddress,
        uint256 amount,
        string memory productId,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s,
        bool isUsd,
        bool senderPaysFee
    )
        public
        onlySupportedToken(tokenAddress)
        validTransferAmount(amount, tokenAddress)
        whenNotPaused
        returns (bool)
    {
        require(bytes(productId).length > 0, "Product ID required");
        (uint256 serviceFee, uint256 licenseFee) = calculateFees(amount, isUsd);

        _adjustBalances(
            tokenAddress,
            senderAddress,
            recipientAddress,
            amount,
            deadline,
            v,
            r,
            s,
            isUsd,
            senderPaysFee
        );

        emit PurchaseCompleted(
            tokenAddress,
            senderAddress,
            recipientAddress,
            amount,
            block.timestamp,
            serviceFee,
            licenseFee,
            productId
        );

        return true;
    }

    function withdrawERC20Token(address _tokenAddress) public onlyOwner {
        IERC20 token = IERC20(_tokenAddress);
        require(
            token.balanceOf(address(this)) != 0,
            "Insufficient payment token balance"
        );

        uint256 amount = token.balanceOf(address(this));
        token.transfer(_msgSender(), amount);
    }

    function updateTokenInfo(
        address _tokenAddress,
        uint256 _minTransferAmount,
        uint256 _maxTransferAmount
    ) public onlyOwner {
        require(_tokenAddress != address(0), "Token address must be provided");
        require(
            tokenInfo[_tokenAddress].token != IERC20(address(0)),
            "Token not found"
        );
        require(
            _minTransferAmount <= _maxTransferAmount,
            "Invalid transfer limits"
        );

        TokenInfo storage token = tokenInfo[_tokenAddress];

        // Update transfer limits
        if (token.minTransferAmount != _minTransferAmount) {
            uint256 oldMin = token.minTransferAmount;
            token.minTransferAmount = _minTransferAmount;
            emit MinTransferAmountUpdated(oldMin, _minTransferAmount);
        }
    }

    // Add getter function for user transfer limits
    function getUserTransferLimits(
        address user
    ) public view returns (uint256 dailyAmount, uint256 yearlyAmount) {
        (dailyAmount, yearlyAmount) = _unpackAmounts(userTransferLimits[user]);
        return (dailyAmount, yearlyAmount);
    }

    // Simplified KYC validity check - just compare current time with expiration
    function isKYCValid(address user) public view returns (bool) {
        return kycExpiration[user] > block.timestamp;
    }

    // Simplified KYC status check
    function getKYCStatus(address user) public view returns (
        bool isValid,
        uint256 expirationTimestamp
    ) {
        expirationTimestamp = kycExpiration[user];
        isValid = isKYCValid(user);
        return (isValid, expirationTimestamp);
    }
}
