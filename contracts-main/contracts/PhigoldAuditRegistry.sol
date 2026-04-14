// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

contract GldAuditRegistry is Ownable {
    mapping(uint256 => string) public mintAuditReports;
    address public gldContract;

    event AuditReportAdded(uint256 indexed mintId, string reportCID);
    event GldContractUpdated(address indexed oldAddress, address indexed newAddress);

    constructor() Ownable(msg.sender) {}

    modifier onlyGld() {
        require(msg.sender == gldContract, "Caller is not the Gld contract");
        _;
    }

    function setGldContract(address _gldContract) external onlyOwner {
        require(_gldContract != address(0), "Invalid address");
        emit GldContractUpdated(gldContract, _gldContract);
        gldContract = _gldContract;
    }

    function addAuditReport(uint256 _mintId, string memory _reportCID) external onlyGld {
        require(bytes(_reportCID).length > 0, "CID cannot be empty");
        mintAuditReports[_mintId] = _reportCID;
        emit AuditReportAdded(_mintId, _reportCID);
    }

    function getAuditReport(uint256 _mintId) external view returns (string memory) {
        return mintAuditReports[_mintId];
    }
}

