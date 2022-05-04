// SPDX-License-Identifier: MIT

pragma solidity ^0.8.4;

import "./BaseLaunchpeg.sol";
import "./interfaces/IFlatLaunchpeg.sol";
import "./interfaces/ILaunchpeg.sol";
import "./interfaces/IBatchReveal.sol";
import "./interfaces/ILaunchpegFactory.sol";
import "erc721a-upgradeable/contracts/ERC721AUpgradeable.sol";

error LaunchpegLens__InvalidContract();

/// @title Launchpeg Lens
/// @author Trader Joe
/// @notice Helper contract to fetch launchpegs data
contract LaunchpegLens {
    struct CollectionData {
        string name;
        string symbol;
        uint256 collectionSize;
        uint256 maxBatchSize;
        uint256 totalSupply;
    }

    struct LaunchpegData {
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
        ILaunchpeg.Phase currentPhase;
        uint256 auctionPrice;
        uint256 mintlistPrice;
        uint256 publicSalePrice;
        uint256 amountMintedDuringAuction;
        uint256 lastAuctionPrice;
    }

    struct FlatLaunchpegData {
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

    /// Global struct that is returned by getAllLaunchpegs()
    struct LensData {
        address id;
        LaunchpegType launchType;
        CollectionData collectionData;
        LaunchpegData launchpegData;
        FlatLaunchpegData flatLaunchpegData;
        RevealData revealData;
        UserData userData;
    }

    enum LaunchpegType {
        Unknown,
        Launchpeg,
        FlatLaunchpeg
    }

    /// @notice ILaunchpegInterface identifier
    bytes4 public immutable launchpegInterface;

    /// @notice IFlatLaunchpegInterface identifier
    bytes4 public immutable flatLaunchpegInterface;

    /// @notice LaunchpegFactory address
    address public immutable launchpegFactory;

    /// @dev LaunchpegLens constructor
    /// @param _launchpegFactory Address of the LaunchpegFactory
    constructor(address _launchpegFactory) {
        launchpegInterface = type(ILaunchpeg).interfaceId;
        flatLaunchpegInterface = type(IFlatLaunchpeg).interfaceId;
        launchpegFactory = _launchpegFactory;
    }

    /// @notice Gets the type of Launchpeg
    /// @param _contract Contract address to consider
    /// @return LaunchpegType Type of Launchpeg implementation (Dutch Auction / Flat / Unknown)
    function getLaunchpegType(address _contract)
        public
        view
        returns (LaunchpegType)
    {
        if (BaseLaunchpeg(_contract).supportsInterface(launchpegInterface)) {
            return LaunchpegType.Launchpeg;
        } else if (
            BaseLaunchpeg(_contract).supportsInterface(flatLaunchpegInterface)
        ) {
            return LaunchpegType.FlatLaunchpeg;
        } else {
            return LaunchpegType.Unknown;
        }
    }

    /// @notice Fetch Launchpeg data
    /// @param _offset Index to start at when looking up Launchpegs
    /// @param _limit Maximum number of Launchpegs datas to return
    /// @param _user Address to consider for NFT balances and mintlist allocations
    /// @return LensDataList List of contracts datas
    function getAllLaunchpegs(
        uint256 _offset,
        uint256 _limit,
        address _user
    ) external view returns (LensData[] memory) {
        LensData[] memory LensDatas;
        uint256 numLaunchpegs = ILaunchpegFactory(launchpegFactory)
            .numLaunchpegs();

        if (_offset >= numLaunchpegs || _limit == 0) {
            return LensDatas;
        }

        uint256 end = _offset + _limit > numLaunchpegs
            ? numLaunchpegs
            : _offset + _limit;

        LensDatas = new LensData[](end - _offset);

        for (uint256 i = 0; i < LensDatas.length; i++) {
            LensDatas[i] = getLaunchpegData(
                ILaunchpegFactory(launchpegFactory).allLaunchpegs(i),
                _user
            );
        }

        return LensDatas;
    }

    /// @notice Fetch Launchpeg data from the provided address
    /// @param _launchpeg Contract address to consider
    /// @param _user Address to consider for NFT balances and mintlist allocations
    /// @return LensData Contract data
    function getLaunchpegData(address _launchpeg, address _user)
        public
        view
        returns (LensData memory)
    {
        LensData memory data;
        data.id = _launchpeg;
        data.launchType = getLaunchpegType(_launchpeg);

        if (data.launchType == LaunchpegType.Unknown) {
            revert LaunchpegLens__InvalidContract();
        }

        data.collectionData.name = ERC721AUpgradeable(_launchpeg).name();
        data.collectionData.symbol = ERC721AUpgradeable(_launchpeg).symbol();
        data.collectionData.collectionSize = BaseLaunchpeg(_launchpeg)
            .collectionSize();
        data.collectionData.maxBatchSize = BaseLaunchpeg(_launchpeg)
            .maxBatchSize();
        data.collectionData.totalSupply = ERC721AUpgradeable(_launchpeg)
            .totalSupply();

        data.revealData.revealBatchSize = IBatchReveal(_launchpeg)
            .revealBatchSize();
        data.revealData.lastTokenRevealed = IBatchReveal(_launchpeg)
            .lastTokenRevealed();
        data.revealData.revealStartTime = IBatchReveal(_launchpeg)
            .revealStartTime();
        data.revealData.revealInterval = IBatchReveal(_launchpeg)
            .revealInterval();

        if (data.launchType == LaunchpegType.Launchpeg) {
            data.launchpegData.amountForAuction = ILaunchpeg(_launchpeg)
                .amountForAuction();
            data.launchpegData.amountForMintlist = ILaunchpeg(_launchpeg)
                .amountForMintlist();
            data.launchpegData.auctionSaleStartTime = ILaunchpeg(_launchpeg)
                .auctionSaleStartTime();
            data.launchpegData.mintlistStartTime = ILaunchpeg(_launchpeg)
                .mintlistStartTime();
            data.launchpegData.publicSaleStartTime = ILaunchpeg(_launchpeg)
                .publicSaleStartTime();
            data.launchpegData.auctionStartPrice = ILaunchpeg(_launchpeg)
                .auctionStartPrice();
            data.launchpegData.auctionEndPrice = ILaunchpeg(_launchpeg)
                .auctionEndPrice();
            data.launchpegData.auctionSaleDuration = ILaunchpeg(_launchpeg)
                .auctionSaleDuration();
            data.launchpegData.auctionDropInterval = ILaunchpeg(_launchpeg)
                .auctionDropInterval();
            data.launchpegData.auctionDropPerStep = ILaunchpeg(_launchpeg)
                .auctionDropPerStep();
            data.launchpegData.mintlistDiscountPercent = ILaunchpeg(_launchpeg)
                .mintlistDiscountPercent();
            data.launchpegData.publicSaleDiscountPercent = ILaunchpeg(
                _launchpeg
            ).publicSaleDiscountPercent();
            data.launchpegData.currentPhase = ILaunchpeg(_launchpeg)
                .currentPhase();
            data.launchpegData.auctionPrice = ILaunchpeg(_launchpeg)
                .getAuctionPrice(data.launchpegData.auctionSaleStartTime);
            data.launchpegData.mintlistPrice = ILaunchpeg(_launchpeg)
                .getMintlistPrice();
            data.launchpegData.publicSalePrice = ILaunchpeg(_launchpeg)
                .getPublicSalePrice();
            data.launchpegData.amountMintedDuringAuction = ILaunchpeg(
                _launchpeg
            ).amountMintedDuringAuction();
            data.launchpegData.lastAuctionPrice = ILaunchpeg(_launchpeg)
                .lastAuctionPrice();
        }

        if (data.launchType == LaunchpegType.FlatLaunchpeg) {
            data.flatLaunchpegData.mintlistPrice = IFlatLaunchpeg(_launchpeg)
                .mintlistPrice();
            data.flatLaunchpegData.salePrice = IFlatLaunchpeg(_launchpeg)
                .salePrice();
            data.flatLaunchpegData.isPublicSaleActive = IFlatLaunchpeg(
                _launchpeg
            ).isPublicSaleActive();
        }

        if (_user != address(0)) {
            data.userData.balanceOf = ERC721AUpgradeable(_launchpeg).balanceOf(
                _user
            );
            data.userData.allowanceForAllowlistMint = IBaseLaunchpeg(_launchpeg)
                .allowList(_user);
        }

        return data;
    }
}
