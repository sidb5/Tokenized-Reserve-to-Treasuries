// SPDX-License-Identifier: MIT
/// @custom:security-contact steven@phinance.gold
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IGldAuditRegistry {
    function addAuditReport(uint256 _mintId, string memory _reportCID) external;
}

contract Gld is ERC20, ERC20Burnable, ERC20Pausable, ERC20Permit, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 usdExchangeRate = 100000000; // 1 Gld = 100 USD initially
    uint256 public supportedTokenCount;
    uint256 public lastMintId;
    
    IGldAuditRegistry public auditRegistry;

    constructor(address _auditRegistry) 
        ERC20("Phinance.Gold", "GLD") 
        ERC20Permit("Phinance.Gold")
        Ownable(msg.sender) 
    {
        require(_auditRegistry != address(0), "Invalid address");
        auditRegistry = IGldAuditRegistry(_auditRegistry);
    }

    mapping(address => bool) public isSupportedToken;
    mapping(address => uint256) public tokenExchangeRate;

    event MintEvent(
        address triggerer,
        uint256 amount,
        uint256 timestamp,
        string auditReportLink
    );

    event BurnEvent(
        address triggerer,
        uint256 amount,
        uint256 timestamp,
        string auditReportLink
    );

    event SwapCompleted(
        address indexed sender,
        address indexed paymentTokenAddress,
        uint256 paymentTokenAmount,
        uint256 receivedAmount,
        uint256 timestamp
    );

    event TokenAdded(address tokenAddress, uint256 exchangeRate);
    event TokenRemoved(address tokenAddress);
    event AuditRegistryUpdated(address indexed oldRegistry, address indexed newRegistry);

    modifier onlySupportedToken(address _tokenAddress) {
        require(isSupportedToken[_tokenAddress], "Token not supported");
        _;
    }

    function setAuditRegistry(address _auditRegistry) public onlyOwner {
        require(_auditRegistry != address(0), "Invalid address");
        emit AuditRegistryUpdated(address(auditRegistry), _auditRegistry);
        auditRegistry = IGldAuditRegistry(_auditRegistry);
    }

    function getAuditRegistry() public view returns (address) {
        return address(auditRegistry);
    }

    function addSupportedToken(
        address _tokenAddress,
        uint256 _exchangeRate
    ) public onlyOwner {
        require(_tokenAddress != address(0), "Token address must be provided");
        require(
            !isSupportedToken[_tokenAddress],
            "Token already exists"
        );
        require(_exchangeRate > 0, "Exchange Rate must be greater than 0");

        try IERC20Permit(_tokenAddress).DOMAIN_SEPARATOR() returns (bytes32) {
            tokenExchangeRate[_tokenAddress] = _exchangeRate;
            isSupportedToken[_tokenAddress] = true;
            supportedTokenCount++;
            emit TokenAdded(_tokenAddress, _exchangeRate);
        } catch {
            revert("Token must implement ERC20Permit");
        }
    }

    function removeSupportedToken(address _tokenAddress) public onlyOwner {
        require(_tokenAddress != address(0), "Token address must be provided");
        require(
            isSupportedToken[_tokenAddress],
            "Token not found"
        );
        delete tokenExchangeRate[_tokenAddress];
        delete isSupportedToken[_tokenAddress];
        supportedTokenCount--;
        emit TokenRemoved(_tokenAddress);
    }

    function setUsdExchangeRate(uint256 _newUsdExchangeRate) public onlyOwner {
        usdExchangeRate = _newUsdExchangeRate;
    }

    function setPaymentTokenExchangeRate(
        address _paymentTokenAddress,
        uint256 _newExchangeRate
    ) public onlyOwner {
        require(
            isSupportedToken[_paymentTokenAddress],
            "Token not supported"
        );
        tokenExchangeRate[_paymentTokenAddress] = _newExchangeRate;
    }

    function getTokenExchangeRate(
        address _tokenAddress
    ) public view returns (uint256) {
        return tokenExchangeRate[_tokenAddress];
    }

    function getUsdExchangeRate() public view returns (uint256) {
        return usdExchangeRate;
    }

    // Payment Token amount =  (GldAmount * Exchange Rate) / 10^GldDecimals
    function calculatePaymentTokenForGld(
        address _paymentTokenAddress,
        uint256 _gldAmount,
        bool _useUsdExchangeRate
    ) public view returns (uint256) {
        uint256 gldDecimals = decimals();
        uint256 exchangeRate = _useUsdExchangeRate ? usdExchangeRate : tokenExchangeRate[_paymentTokenAddress];

        return _gldAmount * exchangeRate / (10 ** gldDecimals);
    }

    // Gld amount = (Payment Token amount * 10^GldDecimals) / Exchange Rate
    function calculateGldForPaymentToken(
        address _paymentTokenAddress,
        uint256 _paymentTokenAmount,
        bool _useUsdExchangeRate
    ) public view returns (uint256) {
        uint256 gldDecimals = decimals();
        uint256 exchangeRate = _useUsdExchangeRate ? usdExchangeRate : tokenExchangeRate[_paymentTokenAddress];

        return (_paymentTokenAmount * 10 ** gldDecimals) / exchangeRate;
    }

    function mintGldSupply(
        uint256 _amount,
        string memory _auditReportCID
    ) public onlyOwner {
        require(address(auditRegistry) != address(0), "Audit Registry not set");
        require(
            bytes(_auditReportCID).length > 0,
            "Audit report IPFS link must be provided"
        );

        _mint(address(this), _amount);
        
        auditRegistry.addAuditReport(lastMintId, _auditReportCID);
        
        lastMintId++;

        emit MintEvent(
            msg.sender,
            _amount,
            block.timestamp,
            _auditReportCID
        );
    }

    function swapSupportedTokenForGld(
        address _paymentTokenAddress,
        uint256 _paymentTokenAmount,
        uint256 _minAmountOut,
        bool _useUsdExchangeRate
    ) public nonReentrant onlySupportedToken(_paymentTokenAddress) {
        require(_paymentTokenAmount > 0, "Payment token amount must be greater than 0");
        uint256 gldAmount = calculateGldForPaymentToken(_paymentTokenAddress, _paymentTokenAmount, _useUsdExchangeRate);
        
        require(gldAmount >= _minAmountOut, "Slippage tolerance exceeded");
        require(gldAmount > 0, "Calculated Gld amount must be greater than 0");
        require(
            balanceOf(address(this)) >= gldAmount,
            "Insufficient GLD balance in contract"
        );

        IERC20(_paymentTokenAddress).safeTransferFrom(
            msg.sender,
            address(this),
            _paymentTokenAmount
        );

        _transfer(address(this), msg.sender, gldAmount);

        emit SwapCompleted(
            msg.sender,
            _paymentTokenAddress,
            _paymentTokenAmount,
            gldAmount,
            block.timestamp
        );
    }

    function swapSupportedTokenForGldWithPermit(
        address _paymentTokenOwner,
        address _paymentTokenAddress,
        uint256 _paymentTokenAmount,
        uint256 _minAmountOut,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s,
        bool _useUsdExchangeRate
    ) public nonReentrant onlySupportedToken(_paymentTokenAddress) {
        require(_paymentTokenOwner != address(0), "Owner address must be provided");
        require(_paymentTokenAddress != address(0), "Payment token address must be provided");
        require(_paymentTokenAmount > 0, "Payment token amount must be greater than 0");
        require(deadline > block.timestamp, "Deadline must be in the future");
        require(v == 27 || v == 28, "Invalid signature v value");
        require(r != bytes32(0) && s != bytes32(0), "Invalid signature r or s value");

        uint256 gldAmount = calculateGldForPaymentToken(_paymentTokenAddress, _paymentTokenAmount, _useUsdExchangeRate);
        
        require(gldAmount >= _minAmountOut, "Slippage tolerance exceeded");
        require(gldAmount > 0, "Calculated Gld amount must be greater than 0");
        require(
            balanceOf(address(this)) >= gldAmount,
            "Insufficient GLD balance in contract"
        );

        IERC20Permit(_paymentTokenAddress).permit(
            _paymentTokenOwner,
            address(this),
            _paymentTokenAmount,
            deadline,
            v,
            r,
            s
        );

        IERC20(_paymentTokenAddress).safeTransferFrom(
            _paymentTokenOwner,
            address(this),
            _paymentTokenAmount
        );

        _transfer(address(this), _paymentTokenOwner, gldAmount);

        emit SwapCompleted(
            _paymentTokenOwner,
            _paymentTokenAddress,
            _paymentTokenAmount,
            gldAmount,
            block.timestamp
        );
    }

    function redeemGld(uint256 _amount, string memory _purchaseId) public nonReentrant {
        require(_amount % (5 * 10 ** decimals()) == 0, "Gld amount must be divisible by 5 GLD units");
        require(balanceOf(msg.sender) >= _amount, "Insufficient GLD balance");
        require(bytes(_purchaseId).length > 0, "Purchase ID must be provided");
        _burn(msg.sender, _amount);

        emit BurnEvent(
            msg.sender,
            _amount,
            block.timestamp,
            string(abi.encodePacked("Gld Redeemed: ", _purchaseId))
        );
    }

    function withdrawERC20Token(address _tokenAddress) public nonReentrant onlyOwner {
        require(_tokenAddress != address(0), "Token address must be provided");
        require(_tokenAddress != address(this), "Cannot withdraw GLD");

        IERC20 token = IERC20(_tokenAddress);
        require(
            token.balanceOf(address(this)) > 0,
            "Insufficient payment token balance"
        );

        uint256 amount = token.balanceOf(address(this));
        token.safeTransfer(msg.sender, amount);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function pause() public onlyOwner {
        _pause();
    }

    function unpause() public onlyOwner {
        _unpause();
    }

    function _update(
        address from,
        address to,
        uint256 value
    ) internal override(ERC20, ERC20Pausable) {
        super._update(from, to, value);
    }
}
