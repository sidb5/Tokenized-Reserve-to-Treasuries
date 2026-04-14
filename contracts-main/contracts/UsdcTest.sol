// SPDX-License-Identifier: MIT
/// @custom:security-contact steven@phinance.gold
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

contract UsdcTest is ERC20Permit {
    constructor() ERC20("USD Coin Test", "USDC") ERC20Permit("USD Coin Test") {}

    function mint(address to, uint256 amount) public {
        _mint(to, amount);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}
