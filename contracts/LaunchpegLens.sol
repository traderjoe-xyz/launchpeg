// SPDX-License-Identifier: MIT

pragma solidity ^0.8.4;

import "@openzeppelin/contracts-upgradeable/access/IAccessControlEnumerableUpgradeable.sol";

import "./interfaces/IBaseLaunchpeg.sol";
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
        string unrevealedURI;
        string baseURI;
    }

    struct ProjectOwnerData {
        address[] projectOwners;
        uint256 amountMintedByDevs;
        uint256 withdrawAVAXStartTime;
        uint256 launchpegBalanceAVAX;
    }

    struct LaunchpegData {
        uint256 amountForAuction;
        uint256 amountForAllowlist;
        uint256 amountForDevs;
        uint256 auctionSaleStartTime;
        uint256 preMintStartTime;
        uint256 allowlistStartTime;
        uint256 publicSaleStartTime;
        uint256 publicSaleEndTime;
        uint256 auctionStartPrice;
        uint256 auctionEndPrice;
        uint256 auctionSaleDuration;
        uint256 auctionDropInterval;
        uint256 auctionDropPerStep;
        uint256 allowlistDiscountPercent;
        uint256 publicSaleDiscountPercent;
        ILaunchpeg.Phase currentPhase;
        uint256 auctionPrice;
        uint256 allowlistPrice;
        uint256 publicSalePrice;
        uint256 amountMintedDuringAuction;
        uint256 lastAuctionPrice;
        uint256 amountMintedDuringPreMint;
        uint256 amountMintedDuringAllowlist;
        uint256 amountMintedDuringPublicSale;
    }

    struct FlatLaunchpegData {
        ILaunchpeg.Phase currentPhase;
        uint256 amountForAllowlist;
        uint256 amountForDevs;
        uint256 preMintStartTime;
        uint256 allowlistStartTime;
        uint256 publicSaleStartTime;
        uint256 publicSaleEndTime;
        uint256 allowlistPrice;
        uint256 salePrice;
        uint256 amountMintedDuringPreMint;
        uint256 amountMintedDuringAllowlist;
        uint256 amountMintedDuringPublicSale;
    }

    struct RevealData {
        uint256 revealBatchSize;
        uint256 lastTokenRevealed;
        uint256 revealStartTime;
        uint256 revealInterval;
    }

    struct UserData {
        uint256 balanceOf;
        uint256 numberMinted;
        uint256 numberMintedWithPreMint;
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
        ProjectOwnerData projectOwnerData;
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

    /// @notice BatchReveal address
    address public immutable batchReveal;

    /// @dev LaunchpegLens constructor
    /// @param _launchpegFactory LaunchpegFactory address
    /// @param _batchReveal BatchReveal address
    constructor(address _launchpegFactory, address _batchReveal) {
        launchpegInterface = type(ILaunchpeg).interfaceId;
        flatLaunchpegInterface = type(IFlatLaunchpeg).interfaceId;
        launchpegFactory = _launchpegFactory;
        batchReveal = _batchReveal;
    }

    /// @notice Gets the type of Launchpeg
    /// @param _contract Contract address to consider
    /// @return LaunchpegType Type of Launchpeg implementation (Dutch Auction / Flat / Unknown)
    function getLaunchpegType(address _contract)
        public
        view
        returns (LaunchpegType)
    {
        if (IBaseLaunchpeg(_contract).supportsInterface(launchpegInterface)) {
            return LaunchpegType.Launchpeg;
        } else if (
            IBaseLaunchpeg(_contract).supportsInterface(flatLaunchpegInterface)
        ) {
            return LaunchpegType.FlatLaunchpeg;
        } else {
            return LaunchpegType.Unknown;
        }
    }

    /// @notice Fetch Launchpeg data
    /// @param _type Type of Launchpeg to consider
    /// @param _number Number of Launchpeg to fetch
    /// @param _limit Last Launchpeg index to fetch
    /// @param _user Address to consider for NFT balances and allowlist allocations
    /// @return LensDataList List of contracts datas, in descending order
    function getAllLaunchpegsFromType(
        uint8 _type,
        uint256 _number,
        uint256 _limit,
        address _user
    ) external view returns (LensData[] memory) {
        LensData[] memory LensDatas;
        uint256 numLaunchpegs = ILaunchpegFactory(launchpegFactory)
            .numLaunchpegs(_type);

        uint256 end = _limit > numLaunchpegs ? numLaunchpegs : _limit;
        uint256 start = _number > end ? 0 : end - _number;

        LensDatas = new LensData[](end - start);

        for (uint256 i = 0; i < LensDatas.length; i++) {
            LensDatas[i] = getLaunchpegData(
                ILaunchpegFactory(launchpegFactory).allLaunchpegs(
                    _type,
                    end - 1 - i
                ),
                _user
            );
        }

        return LensDatas;
    }

    /// @notice Fetch Launchpeg data from the provided address
    /// @param _launchpeg Contract address to consider
    /// @param _user Address to consider for NFT balances and allowlist allocations
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
        data.collectionData.collectionSize = IBaseLaunchpeg(_launchpeg)
            .collectionSize();
        data.collectionData.maxBatchSize = IBaseLaunchpeg(_launchpeg)
            .maxBatchSize();
        data.collectionData.totalSupply = ERC721AUpgradeable(_launchpeg)
            .totalSupply();
        data.collectionData.unrevealedURI = IBaseLaunchpeg(_launchpeg)
            .unrevealedURI();
        data.collectionData.baseURI = IBaseLaunchpeg(_launchpeg).baseURI();

        data.projectOwnerData.projectOwners = getProjectOwners(_launchpeg);
        data.projectOwnerData.withdrawAVAXStartTime = IBaseLaunchpeg(_launchpeg)
            .withdrawAVAXStartTime();
        data.projectOwnerData.launchpegBalanceAVAX = _launchpeg.balance;
        data.projectOwnerData.amountMintedByDevs = IBaseLaunchpeg(_launchpeg)
            .amountMintedByDevs();

        (
            ,
            ,
            uint256 revealBatchSize,
            uint256 revealStartTime,
            uint256 revealInterval
        ) = IBatchReveal(batchReveal).launchpegToConfig(_launchpeg);
        data.revealData.revealBatchSize = revealBatchSize;
        data.revealData.revealStartTime = revealStartTime;
        data.revealData.revealInterval = revealInterval;
        data.revealData.lastTokenRevealed = IBatchReveal(batchReveal)
            .launchpegToLastTokenReveal(_launchpeg);

        if (data.launchType == LaunchpegType.Launchpeg) {
            data.launchpegData.amountForAuction = ILaunchpeg(_launchpeg)
                .amountForAuction();
            data.launchpegData.amountForAllowlist = ILaunchpeg(_launchpeg)
                .amountForAllowlist();
            data.launchpegData.amountForDevs = ILaunchpeg(_launchpeg)
                .amountForDevs();
            data.launchpegData.auctionSaleStartTime = ILaunchpeg(_launchpeg)
                .auctionSaleStartTime();
            data.launchpegData.preMintStartTime = ILaunchpeg(_launchpeg)
                .preMintStartTime();
            data.launchpegData.allowlistStartTime = ILaunchpeg(_launchpeg)
                .allowlistStartTime();
            data.launchpegData.publicSaleStartTime = ILaunchpeg(_launchpeg)
                .publicSaleStartTime();
            data.launchpegData.publicSaleEndTime = ILaunchpeg(_launchpeg)
                .publicSaleEndTime();
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
            data.launchpegData.allowlistDiscountPercent = ILaunchpeg(_launchpeg)
                .allowlistDiscountPercent();
            data.launchpegData.publicSaleDiscountPercent = ILaunchpeg(
                _launchpeg
            ).publicSaleDiscountPercent();
            data.launchpegData.currentPhase = ILaunchpeg(_launchpeg)
                .currentPhase();
            data.launchpegData.auctionPrice = ILaunchpeg(_launchpeg)
                .getAuctionPrice(data.launchpegData.auctionSaleStartTime);
            data.launchpegData.allowlistPrice = ILaunchpeg(_launchpeg)
                .allowlistPrice();
            data.launchpegData.publicSalePrice = ILaunchpeg(_launchpeg)
                .salePrice();
            data.launchpegData.amountMintedDuringAuction = ILaunchpeg(
                _launchpeg
            ).amountMintedDuringAuction();
            data.launchpegData.lastAuctionPrice = ILaunchpeg(_launchpeg)
                .lastAuctionPrice();
            data.launchpegData.amountMintedDuringPreMint = IFlatLaunchpeg(
                _launchpeg
            ).amountMintedDuringPreMint();
            data.launchpegData.amountMintedDuringAllowlist = IBaseLaunchpeg(
                _launchpeg
            ).amountMintedDuringAllowlist();
            data.launchpegData.amountMintedDuringPublicSale = IBaseLaunchpeg(
                _launchpeg
            ).amountMintedDuringPublicSale();
        }

        if (data.launchType == LaunchpegType.FlatLaunchpeg) {
            data.flatLaunchpegData.currentPhase = IFlatLaunchpeg(_launchpeg)
                .currentPhase();
            data.flatLaunchpegData.allowlistPrice = IFlatLaunchpeg(_launchpeg)
                .allowlistPrice();
            data.flatLaunchpegData.salePrice = IFlatLaunchpeg(_launchpeg)
                .salePrice();
            data.flatLaunchpegData.amountMintedDuringPreMint = IFlatLaunchpeg(
                _launchpeg
            ).amountMintedDuringPreMint();
            data.flatLaunchpegData.amountMintedDuringAllowlist = IFlatLaunchpeg(
                _launchpeg
            ).amountMintedDuringAllowlist();
            data
                .flatLaunchpegData
                .amountMintedDuringPublicSale = IFlatLaunchpeg(_launchpeg)
                .amountMintedDuringPublicSale();
            data.flatLaunchpegData.amountForAllowlist = IFlatLaunchpeg(
                _launchpeg
            ).amountForAllowlist();
            data.flatLaunchpegData.amountForDevs = IFlatLaunchpeg(_launchpeg)
                .amountForDevs();
            data.flatLaunchpegData.preMintStartTime = IFlatLaunchpeg(_launchpeg)
                .preMintStartTime();
            data.flatLaunchpegData.allowlistStartTime = IFlatLaunchpeg(
                _launchpeg
            ).allowlistStartTime();
            data.flatLaunchpegData.publicSaleStartTime = IFlatLaunchpeg(
                _launchpeg
            ).publicSaleStartTime();
            data.flatLaunchpegData.publicSaleEndTime = IFlatLaunchpeg(
                _launchpeg
            ).publicSaleEndTime();
        }

        if (_user != address(0)) {
            data.userData.balanceOf = ERC721AUpgradeable(_launchpeg).balanceOf(
                _user
            );
            data.userData.numberMinted = IBaseLaunchpeg(_launchpeg)
                .numberMinted(_user);
            data.userData.numberMintedWithPreMint = IBaseLaunchpeg(_launchpeg)
                .numberMintedWithPreMint(_user);
            data.userData.allowanceForAllowlistMint = IBaseLaunchpeg(_launchpeg)
                .allowlist(_user);
        }

        return data;
    }

    function getProjectOwners(address _launchpeg)
        internal
        view
        returns (address[] memory)
    {
        bytes32 role = IBaseLaunchpeg(_launchpeg).PROJECT_OWNER_ROLE();
        uint256 count = IAccessControlEnumerableUpgradeable(_launchpeg)
            .getRoleMemberCount(role);
        address[] memory projectOwners = new address[](count);
        for (uint256 i; i < count; i++) {
            projectOwners[i] = IAccessControlEnumerableUpgradeable(_launchpeg)
                .getRoleMember(role, i);
        }
        return projectOwners;
    }
}
