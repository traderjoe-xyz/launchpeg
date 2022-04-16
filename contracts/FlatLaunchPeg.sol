// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "./LaunchPegErrors.sol";
import "./interfaces/IFlatLaunchPeg.sol";
import "./BaseLaunchPeg.sol";

contract FlatLaunchPeg is BaseLaunchPeg, IFlatLaunchPeg {
    /// @notice Price of one NFT for people on the mint list
    /// @dev mintlistPrice is scaled to 1e18
    uint256 public immutable mintlistPrice;

    /// @notice The amount of NFTs each allowed address can mint during the allowlist mint
    mapping(address => uint256) public allowlist;

    /// @notice Price of one NFT during the public sale
    /// @dev salePrice is scaled to 1e18
    uint256 public immutable salePrice;

    /// @notice Determine wether or not users are allowed to buy from public sale
    bool public saleIsActive = false;

    constructor(
        string memory _name,
        string memory _symbol,
        address _projectOwner,
        uint256 _maxBatchSize,
        uint256 _collectionSize,
        uint256 _amountForDevs,
        uint256 _batchRevealSize,
        uint256 _salePrice,
        uint256 _mintlistPrice
    )
        BaseLaunchPeg(
            _name,
            _symbol,
            _projectOwner,
            _maxBatchSize,
            _collectionSize,
            _amountForDevs,
            _batchRevealSize
        )
    {
        salePrice = _salePrice;
        mintlistPrice = _mintlistPrice;
    }

    /// @inheritdoc IFlatLaunchPeg
    function seedAllowlist(
        address[] memory _addresses,
        uint256[] memory _numSlots
    ) external override onlyOwner {
        if (_addresses.length != _numSlots.length) {
            revert LaunchPeg__WrongAddressesAndNumSlotsLength();
        }
        for (uint256 i = 0; i < _addresses.length; i++) {
            allowlist[_addresses[i]] = _numSlots[i];
        }
    }

    /// @inheritdoc IFlatLaunchPeg
    function flipSaleState() external override onlyOwner {
        saleIsActive = !saleIsActive;
        // TODO: emit event
    }

    /// @inheritdoc IFlatLaunchPeg
    function allowlistMint() external payable override {
        if (allowlist[msg.sender] <= 0) {
            revert LaunchPeg__NotEligibleForAllowlistMint();
        }
        if (totalSupply() + 1 > collectionSize) {
            revert LaunchPeg__MaxSupplyReached();
        }
        allowlist[msg.sender]--;
        refundIfOver(mintlistPrice);
        _safeMint(msg.sender, 1);
        // TODO: emit event
    }

    /// @inheritdoc IFlatLaunchPeg
    function publicSaleMint(uint256 _quantity) external payable override {
        if (!saleIsActive) {
            revert LaunchPeg__PublicSaleClosed();
        }
        if (_quantity > maxPerAddressDuringMint) {
            revert LaunchPeg__CanNotMintThisMany();
        }
        if (totalSupply() + _quantity > collectionSize) {
            revert LaunchPeg__MaxSupplyReached();
        }
        uint256 total = salePrice * _quantity;
        refundIfOver(total);
        _safeMint(msg.sender, _quantity);
        // TODO: emit event
    }
}
