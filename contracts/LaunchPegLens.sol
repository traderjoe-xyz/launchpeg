// SPDX-License-Identifier: MIT

pragma solidity ^0.8.4;

import "./BaseLaunchPeg.sol";
import "./interfaces/IFlatLaunchPeg.sol";
import "./interfaces/ILaunchPeg.sol";
import "./interfaces/IBatchReveal.sol";
import "erc721a/contracts/ERC721A.sol";

error LaunchPegLens__InvalidContract();

/// @title LaunchPeg Lens
/// @author Trader Joe
/// @notice Helper contract to fetch launchpegs data
contract LaunchPegLens {
    struct CollectionData {
        string name;
        string symbol;
        uint256 collectionSize;
        uint256 maxBatchSize;
        uint256 totalSupply;
    }

    struct LaunchPegData {
        uint256 amountForAuction;
        uint256 amountForMintlist;
        uint256 auctionSaleStartTime;
        uint256 mintlistStartTime;
        uint256 publicSaleStartTime;
        uint256 auctionStartPrice;
        uint256 auctionEndPrice;
        uint256 auctionSaleDuration;
        uint256 auctionDropInterval;
        uint256 auctionDropPerStep;
        uint256 mintlistDiscountPercent;
        uint256 publicSaleDiscountPercent;
        ILaunchPeg.Phase currentPhase;
        uint256 auctionPrice;
        uint256 mintlistPrice;
        uint256 publicSalePrice;
        uint256 amountMintedDuringAuction;
        uint256 lastAuctionPrice;
    }

    struct FlatLaunchPegData {
        uint256 mintlistPrice;
        uint256 salePrice;
        bool isPublicSaleActive;
    }

    struct RevealData {
        uint256 revealBatchSize;
        uint256 lastTokenRevealed;
        uint256 revealStartTime;
        uint256 revealInterval;
    }

    struct UserData {
        uint256 balanceOf;
        uint256 allowanceForAllowlistMint;
    }

    /// Global struct that is returned by getAllLaunchPegs()
    struct LensData {
        address id;
        LaunchPegType launchType;
        CollectionData collectionData;
        LaunchPegData launchPegData;
        FlatLaunchPegData flatLaunchPegData;
        RevealData revealData;
        UserData userData;
    }

    enum LaunchPegType {
        Unknown,
        LaunchPeg,
        FlatLaunchPeg
    }

    /// @notice ILaunchpegInterface identifier
    bytes4 public immutable launchPegInterface;

    /// @notice IFlatLaunchpegInterface identifier
    bytes4 public immutable flatLaunchPegInterface;

    /// @dev LaunchPegLens constructor
    constructor() {
        launchPegInterface = type(ILaunchPeg).interfaceId;
        flatLaunchPegInterface = type(IFlatLaunchPeg).interfaceId;
    }

    /// @notice Gets the type of Launchpeg
    /// @param _contract Contract address to consider
    /// @return LaunchPegType Type of Launchpeg implementation (Dutch Auction / Flat / Unknown)
    function getLaunchPegType(address _contract)
        public
        view
        returns (LaunchPegType)
    {
        if (BaseLaunchPeg(_contract).supportsInterface(launchPegInterface)) {
            return LaunchPegType.LaunchPeg;
        } else if (
            BaseLaunchPeg(_contract).supportsInterface(flatLaunchPegInterface)
        ) {
            return LaunchPegType.FlatLaunchPeg;
        } else {
            return LaunchPegType.Unknown;
        }
    }

    /// @notice Fetch Launchpeg data from a list of addresses
    /// Will revert if a contract in the list is not a Launchpeg
    /// @param _addressList List of contract adresses to consider
    /// @param _user Address to consider for NFT balances and mintlist allocations
    /// @return LensDataList List of contracts datas
    function getAllLaunchPegs(address[] memory _addressList, address _user)
        external
        view
        returns (LensData[] memory)
    {
        LensData[] memory LensDatas = new LensData[](_addressList.length);

        for (uint256 i = 0; i < LensDatas.length; i++) {
            LensDatas[i] = getLaunchPegData(_addressList[i], _user);
        }

        return LensDatas;
    }

    /// @notice Fetch Launchpeg data from the provided address
    /// @param _launchPeg Contract address to consider
    /// @param _user Address to consider for NFT balances and mintlist allocations
    /// @return LensData Contract data
    function getLaunchPegData(address _launchPeg, address _user)
        public
        view
        returns (LensData memory)
    {
        LensData memory data;
        data.id = _launchPeg;
        data.launchType = getLaunchPegType(_launchPeg);

        if (data.launchType == LaunchPegType.Unknown) {
            revert LaunchPegLens__InvalidContract();
        }

        data.collectionData.name = ERC721A(_launchPeg).name();
        data.collectionData.symbol = ERC721A(_launchPeg).symbol();
        data.collectionData.collectionSize = BaseLaunchPeg(_launchPeg)
            .collectionSize();
        data.collectionData.maxBatchSize = BaseLaunchPeg(_launchPeg)
            .maxBatchSize();
        data.collectionData.totalSupply = ERC721A(_launchPeg).totalSupply();

        data.revealData.revealBatchSize = IBatchReveal(_launchPeg)
            .revealBatchSize();
        data.revealData.lastTokenRevealed = IBatchReveal(_launchPeg)
            .lastTokenRevealed();
        data.revealData.revealStartTime = IBatchReveal(_launchPeg)
            .revealStartTime();
        data.revealData.revealInterval = IBatchReveal(_launchPeg)
            .revealInterval();

        if (data.launchType == LaunchPegType.LaunchPeg) {
            data.launchPegData.amountForAuction = ILaunchPeg(_launchPeg)
                .amountForAuction();
            data.launchPegData.amountForMintlist = ILaunchPeg(_launchPeg)
                .amountForMintlist();
            data.launchPegData.auctionSaleStartTime = ILaunchPeg(_launchPeg)
                .auctionSaleStartTime();
            data.launchPegData.mintlistStartTime = ILaunchPeg(_launchPeg)
                .mintlistStartTime();
            data.launchPegData.publicSaleStartTime = ILaunchPeg(_launchPeg)
                .publicSaleStartTime();
            data.launchPegData.auctionStartPrice = ILaunchPeg(_launchPeg)
                .auctionStartPrice();
            data.launchPegData.auctionEndPrice = ILaunchPeg(_launchPeg)
                .auctionEndPrice();
            data.launchPegData.auctionSaleDuration = ILaunchPeg(_launchPeg)
                .auctionSaleDuration();
            data.launchPegData.auctionDropInterval = ILaunchPeg(_launchPeg)
                .auctionDropInterval();
            data.launchPegData.auctionDropPerStep = ILaunchPeg(_launchPeg)
                .auctionDropPerStep();
            data.launchPegData.mintlistDiscountPercent = ILaunchPeg(_launchPeg)
                .mintlistDiscountPercent();
            data.launchPegData.publicSaleDiscountPercent = ILaunchPeg(
                _launchPeg
            ).publicSaleDiscountPercent();
            data.launchPegData.currentPhase = ILaunchPeg(_launchPeg)
                .currentPhase();
            data.launchPegData.auctionPrice = ILaunchPeg(_launchPeg)
                .getAuctionPrice(data.launchPegData.auctionSaleStartTime);
            data.launchPegData.mintlistPrice = ILaunchPeg(_launchPeg)
                .getMintlistPrice();
            data.launchPegData.publicSalePrice = ILaunchPeg(_launchPeg)
                .getPublicSalePrice();
            data.launchPegData.amountMintedDuringAuction = ILaunchPeg(
                _launchPeg
            ).amountMintedDuringAuction();
            data.launchPegData.lastAuctionPrice = ILaunchPeg(_launchPeg)
                .lastAuctionPrice();
        }

        if (data.launchType == LaunchPegType.FlatLaunchPeg) {
            data.flatLaunchPegData.mintlistPrice = IFlatLaunchPeg(_launchPeg)
                .mintlistPrice();
            data.flatLaunchPegData.salePrice = IFlatLaunchPeg(_launchPeg)
                .salePrice();
            data.flatLaunchPegData.isPublicSaleActive = IFlatLaunchPeg(
                _launchPeg
            ).isPublicSaleActive();
        }

        if (_user != address(0)) {
            data.userData.balanceOf = ERC721A(_launchPeg).balanceOf(_user);
            data.userData.allowanceForAllowlistMint = IBaseLaunchPeg(_launchPeg)
                .allowList(_user);
        }

        return data;
    }
}
