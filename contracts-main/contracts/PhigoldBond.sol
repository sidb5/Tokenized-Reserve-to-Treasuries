// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract GldBond is ERC721, ERC721Enumerable, Ownable {
    uint256 private _nextTokenId;

    enum BondStatus { Pending, Purchased, Vaulted, Redeemed }

    struct Bond {
        uint256 gldAmount;
        uint256 maturityDate;
        bool redeemed;
        BondStatus status;
        bytes32 purchaseOrderHash;
        bytes32 auditReportHash;
    }

    mapping(uint256 => Bond) public bonds;
    address public authorizedRedeemer;

    mapping(address => uint256[]) private _ownedTokens;

    uint256 public maturityPeriod = 30 days;
    uint256 public bonusPercentage = 4; // 4% bonus

    // Events
    event BondMinted(uint256 indexed tokenId, address indexed to, uint256 gldAmount, uint256 maturityDate);
    event MaturityPeriodChanged(uint256 oldPeriod, uint256 newPeriod);
    event BonusPercentageChanged(uint256 oldPercentage, uint256 newPercentage);
    event AuthorizedRedeemerChanged(address oldRedeemer, address newRedeemer);
    event BondStatusUpdated(uint256 indexed tokenId, BondStatus newStatus);
    event PurchaseOrderHashUpdated(uint256 indexed tokenId, bytes32 purchaseOrderHash);
    event AuditReportHashUpdated(uint256 indexed tokenId, bytes32 auditReportHash);
    event BondBurned(uint256 indexed tokenId, address indexed burner);

    constructor() ERC721("GldBond", "PHIBOND") Ownable(msg.sender) {}

    function setAuthorizedRedeemer(address _redeemer) external onlyOwner {
        address oldRedeemer = authorizedRedeemer;
        authorizedRedeemer = _redeemer;
        emit AuthorizedRedeemerChanged(oldRedeemer, _redeemer);
    }

    function setMaturityPeriod(uint256 _newMaturityPeriod) external onlyOwner {
        uint256 oldPeriod = maturityPeriod;
        maturityPeriod = _newMaturityPeriod;
        emit MaturityPeriodChanged(oldPeriod, _newMaturityPeriod);
    }

    function setBonusPercentage(uint256 _newBonusPercentage) external onlyOwner {
        require(_newBonusPercentage <= 100, "Bonus percentage must be <= 100");
        uint256 oldPercentage = bonusPercentage;
        bonusPercentage = _newBonusPercentage;
        emit BonusPercentageChanged(oldPercentage, _newBonusPercentage);
    }

    function mintBond(address to, uint256 gldAmount) public onlyOwner {
        uint256 tokenId = _nextTokenId++;
        _safeMint(to, tokenId);

        uint256 bonusAmount = (gldAmount * bonusPercentage) / 100;
        uint256 totalAmount = gldAmount + bonusAmount;
        uint256 maturityDate = block.timestamp + maturityPeriod;

        bonds[tokenId] = Bond({
            gldAmount: totalAmount,
            maturityDate: maturityDate,
            redeemed: false,
            status: BondStatus.Pending,
            purchaseOrderHash: bytes32(0),
            auditReportHash: bytes32(0)
        });

        emit BondMinted(tokenId, to, totalAmount, maturityDate);
    }

    function updateBondStatus(uint256 tokenId, BondStatus newStatus) external onlyOwner {
        require(_ownerOf(tokenId) != address(0), "Bond does not exist");
        bonds[tokenId].status = newStatus;
        emit BondStatusUpdated(tokenId, newStatus);
    }

    function updatePurchaseOrderHash(uint256 tokenId, bytes32 purchaseOrderHash) external onlyOwner {
        require(_ownerOf(tokenId) != address(0), "Bond does not exist");
        bonds[tokenId].purchaseOrderHash = purchaseOrderHash;
        emit PurchaseOrderHashUpdated(tokenId, purchaseOrderHash);
    }

    function updateAuditReportHash(uint256 tokenId, bytes32 auditReportHash) external onlyOwner {
        require(_ownerOf(tokenId) != address(0), "Bond does not exist");
        bonds[tokenId].auditReportHash = auditReportHash;
        emit AuditReportHashUpdated(tokenId, auditReportHash);
    }

    function getBondDetails(uint256 tokenId) public view returns (Bond memory) {
        require(_ownerOf(tokenId) != address(0), "Bond does not exist");
        return bonds[tokenId];
    }

    function setRedeemed(uint256 tokenId) external {
        require(msg.sender == authorizedRedeemer, "Only authorized redeemer can set redeemed status");
        require(_ownerOf(tokenId) != address(0), "Bond does not exist");
        require(!bonds[tokenId].redeemed, "Bond already redeemed");
        bonds[tokenId].redeemed = true;
    }

    function getBondsByOwner(address owner) public view returns (uint256[] memory) {
        return _ownedTokens[owner];
    }

    function _update(address to, uint256 tokenId, address auth) internal override(ERC721, ERC721Enumerable) returns (address) {
        address from = _ownerOf(tokenId);
        address updatedAddress = super._update(to, tokenId, auth);

        if (from != to) {
            if (from != address(0)) {
                uint256[] storage fromTokens = _ownedTokens[from];
                for (uint i = 0; i < fromTokens.length; i++) {
                    if (fromTokens[i] == tokenId) {
                        fromTokens[i] = fromTokens[fromTokens.length - 1];
                        fromTokens.pop();
                        break;
                    }
                }
            }

            if (to != address(0)) {
                _ownedTokens[to].push(tokenId);
            }
        }

        return updatedAddress;
    }

    function _increaseBalance(address account, uint128 amount) internal override(ERC721, ERC721Enumerable) {
        super._increaseBalance(account, amount);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC721Enumerable) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    function burn(uint256 tokenId) public {
        require(authorizedRedeemer == _msgSender(), "GldBond: caller is not authorized redeemer");
        require(!bonds[tokenId].redeemed, "GldBond: token already redeemed");
        
        bonds[tokenId].redeemed = true;
        _burn(tokenId);
        
        emit BondBurned(tokenId, _msgSender());
    }
}