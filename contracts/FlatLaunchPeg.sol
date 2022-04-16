// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "./LaunchPegErrors.sol";
import "./interfaces/IFlatLaunchPeg.sol";
import "./BaseLaunchPeg.sol";

contract FlatLaunchPeg is BaseLaunchPeg, IFlatLaunchPeg {
    /// @notice Price of one NFT for people on the mint list
    /// @dev mintlistPrice is scaled to 1e18
    uint256 public immutable mintlistPrice;

    /// @notice Price of one NFT during the public sale
    /// @dev salePrice is scaled to 1e18
    uint256 public immutable salePrice;

    /// @notice Determine wether or not users are allowed to buy from public sale
    bool public isPublicSaleActive = false;

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
    function setPublicSaleActive(bool _isPublicSaleActive)
        external
        override
        onlyOwner
    {
        isPublicSaleActive = _isPublicSaleActive;
        emit PublicSaleStateChanged(_isPublicSaleActive);
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
        emit Mint(msg.sender, 1, mintlistPrice, _totalMinted() - 1);
    }

    /// @inheritdoc IFlatLaunchPeg
    function publicSaleMint(uint256 _quantity) external payable override {
        if (!isPublicSaleActive) {
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
        emit Mint(msg.sender, _quantity, total, _totalMinted() - _quantity);
    }
}
