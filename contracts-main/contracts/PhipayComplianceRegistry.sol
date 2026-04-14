// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IOmegapayComplianceRegistry {
    function isKYCValid(address user) external view returns (bool);
    function isBlacklisted(address user) external view returns (bool);
    function kycExpiration(address user) external view returns (uint256);
    function refreshKYCExpiration(address user) external;
    function setKYCExpiration(address user, uint256 expiration) external;
    function setBlacklist(address user, bool value) external;
    function getTimeUntilKycExpiration(address user) external view returns (uint256);
}

import "@openzeppelin/contracts/access/Ownable.sol";

contract OmegapayComplianceRegistry is Ownable, IOmegapayComplianceRegistry {
    address public complianceAdmin;

    mapping(address => uint256) public kycExpiration; // date that KYC is valid until
    mapping(address => bool) public blacklist;

    event KYCUpdated(address indexed user, uint256 expiration);
    event BlacklistUpdated(address indexed user, bool blacklisted);
    event ComplianceAdminUpdated(address indexed oldAdmin, address indexed newAdmin);

    constructor(address _complianceAdmin) Ownable(msg.sender) {
        complianceAdmin = _complianceAdmin;
        kycExpiration[_complianceAdmin] = type(uint256).max;
    }

    modifier onlyComplianceAdmin() {
        require(msg.sender == complianceAdmin, "only compliance admin");
        _;
    }

    function setComplianceAdmin(address newComplianceAdmin) external onlyOwner {
        require(newComplianceAdmin != address(0), "invalid compliance admin");
        emit ComplianceAdminUpdated(complianceAdmin, newComplianceAdmin);
        complianceAdmin = newComplianceAdmin;
    }

    function refreshKYCExpiration(address user) external onlyComplianceAdmin {
        kycExpiration[user] = block.timestamp + 2 * 365 days; // 2 years from now
        emit KYCUpdated(user, kycExpiration[user]);
    }

    function setKYCExpiration(address user, uint256 expiration) external onlyComplianceAdmin {
        kycExpiration[user] = expiration;
        emit KYCUpdated(user, expiration);
    }

    function setBlacklist(address user, bool value) external onlyComplianceAdmin {
        blacklist[user] = value;
        emit BlacklistUpdated(user, value);
    }

    function isKYCValid(address user) external view returns (bool) {
        return kycExpiration[user] > block.timestamp;
    }

    function isBlacklisted(address user) external view returns (bool) {
        return blacklist[user];
    }

    function getTimeUntilKycExpiration(address user) external view returns (uint256) {
        if (kycExpiration[user] > block.timestamp) {
            return kycExpiration[user] - block.timestamp; // time until KYC expiration
        }
        return 0; // KYC is expired
    }
}