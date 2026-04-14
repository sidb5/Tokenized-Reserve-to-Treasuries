// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

contract VariableDecimalsMockToken is ERC20Permit {
    uint8 private _decimals;
    constructor(uint8 setDecimals) ERC20("Variable Decimals Mock Token", "VDMT") ERC20Permit("Variable Decimals Mock Token") {
        _decimals = setDecimals;
    }

    function mint(address to, uint256 amount) public {
        _mint(to, amount);
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }
} 