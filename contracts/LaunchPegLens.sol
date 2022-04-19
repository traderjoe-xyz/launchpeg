// SPDX-License-Identifier: MIT

pragma solidity ^0.8.4;

import "./interfaces/IBaseLaunchPeg.sol";
import "./interfaces/IFlatLaunchPeg.sol";
import "./interfaces/ILaunchPeg.sol";
import "./interfaces/IBatchReveal.sol";
import "erc721a/contracts/ERC721A.sol";

/// @title LaunchPeg Lens
/// @author Trader Joe
/// @notice Helper contract to fetch launchpegs data
contract LaunchPegLens {
    struct LaunchPegData {
        address id;
        LaunchPegType launchType;
        //ERC721A
        string name;
        string symbol;
        uint256 totalSupply;
        uint256 balanceOf;
        // Base Launchpeg
        uint256 collectionSize;
        uint256 maxBatchSize;
        uint256 allowlist;
        // Batch reveal
        uint256 revealBatchSize;
        uint256 lastTokenRevealed;
        uint256 revealStartTime;
        uint256 revealInterval;
        // Flat LaunchPeg
        uint256 mintlistPrice;
        uint256 salePrice;
        bool isPublicSaleActive;
        // LaunchPeg
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
    }

    enum LaunchPegType {
        Unknown,
        LaunchPeg,
        FlatLaunchPeg
    }

    bytes4 public immutable launchPegInterface;
    bytes4 public immutable flatLaunchPegInterface;

    constructor() {
        launchPegInterface = type(ILaunchPeg).interfaceId;
        flatLaunchPegInterface = type(IFlatLaunchPeg).interfaceId;
    }

    function getAllLaunchPegs(address[] memory _addressList)
        external
        view
        returns (LaunchPegData[] memory)
    {
        LaunchPegData[] memory LaunchPegDatas = new LaunchPegData[](
            _addressList.length
        );

        for (uint256 i = 0; i < LaunchPegDatas.length; i++) {
            LaunchPegDatas[i] = getLaunchPegData(_addressList[i]);
        }

        return LaunchPegDatas;
    }

    function getAllLaunchPegsWithUser(
        address[] memory _addressList,
        address _user
    ) external view returns (LaunchPegData[] memory) {
        LaunchPegData[] memory LaunchPegDatas = new LaunchPegData[](
            _addressList.length
        );

        for (uint256 i = 0; i < LaunchPegDatas.length; i++) {
            LaunchPegDatas[i] = getLaunchPegUserData(_addressList[i], _user);
        }

        return LaunchPegDatas;
    }

    function getLaunchPegType(address _contract)
        public
        view
        returns (LaunchPegType)
    {
        if (IBaseLaunchPeg(_contract).supportsInterface(launchPegInterface)) {
            return LaunchPegType.LaunchPeg;
        } else if (
            IBaseLaunchPeg(_contract).supportsInterface(flatLaunchPegInterface)
        ) {
            return LaunchPegType.FlatLaunchPeg;
        } else {
            return LaunchPegType.Unknown;
        }
    }

    function getLaunchPegUserData(address _launchPeg, address _user)
        private
        view
        returns (LaunchPegData memory)
    {
        LaunchPegData memory data = getLaunchPegData(_launchPeg);

        data.balanceOf = ERC721A(_launchPeg).balanceOf(_user);

        if (data.launchType != LaunchPegType.Unknown) {
            data.allowlist = IBaseLaunchPeg(_launchPeg).allowlist(_user);
        }

        return data;
    }

    function getLaunchPegData(address _launchPeg)
        private
        view
        returns (LaunchPegData memory)
    {
        LaunchPegData memory data;
        data.id = _launchPeg;
        data.launchType = getLaunchPegType(_launchPeg);

        if (data.launchType != LaunchPegType.Unknown) {
            data.name = ERC721A(_launchPeg).name();
            data.symbol = ERC721A(_launchPeg).symbol();
            data.collectionSize = IBaseLaunchPeg(_launchPeg).collectionSize();
            data.totalSupply = ERC721A(_launchPeg).totalSupply();
        }

        if (data.launchType == LaunchPegType.LaunchPeg) {
            data.revealBatchSize = IBatchReveal(_launchPeg).revealBatchSize();
            data.lastTokenRevealed = IBatchReveal(_launchPeg)
                .lastTokenRevealed();
            data.revealStartTime = IBatchReveal(_launchPeg).revealStartTime();
            data.revealInterval = IBatchReveal(_launchPeg).revealInterval();

            data.amountForAuction = ILaunchPeg(_launchPeg).amountForAuction();
            data.amountForMintlist = ILaunchPeg(_launchPeg).amountForMintlist();
            data.auctionSaleStartTime = ILaunchPeg(_launchPeg)
                .auctionSaleStartTime();
            data.mintlistStartTime = ILaunchPeg(_launchPeg).mintlistStartTime();
            data.publicSaleStartTime = ILaunchPeg(_launchPeg)
                .publicSaleStartTime();
            data.auctionStartPrice = ILaunchPeg(_launchPeg).auctionStartPrice();
            data.auctionEndPrice = ILaunchPeg(_launchPeg).auctionEndPrice();
            data.auctionSaleDuration = ILaunchPeg(_launchPeg)
                .auctionSaleDuration();
            data.auctionDropInterval = ILaunchPeg(_launchPeg)
                .auctionDropInterval();
            data.auctionDropPerStep = ILaunchPeg(_launchPeg)
                .auctionDropPerStep();
            data.mintlistDiscountPercent = ILaunchPeg(_launchPeg)
                .mintlistDiscountPercent();
            data.publicSaleDiscountPercent = ILaunchPeg(_launchPeg)
                .publicSaleDiscountPercent();
        }

        if (data.launchType == LaunchPegType.FlatLaunchPeg) {
            data.mintlistPrice = IFlatLaunchPeg(_launchPeg).mintlistPrice();
            data.salePrice = IFlatLaunchPeg(_launchPeg).salePrice();
            data.isPublicSaleActive = IFlatLaunchPeg(_launchPeg)
                .isPublicSaleActive();
        }

        return data;
    }
}
