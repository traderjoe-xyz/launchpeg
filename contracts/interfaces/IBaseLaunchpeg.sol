// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "@openzeppelin/contracts-upgradeable/token/ERC721/IERC721Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/IERC721MetadataUpgradeable.sol";

import "erc721a-upgradeable/contracts/ERC721AUpgradeable.sol";

/// @title IBaseLaunchpeg
/// @author Trader Joe
/// @notice Defines the basic interface of BaseLaunchpeg
interface IBaseLaunchpeg is IERC721Upgradeable, IERC721MetadataUpgradeable {
    function collectionSize() external view returns (uint256);

    function amountForDevs() external view returns (uint256);

    function maxBatchSize() external view returns (uint256);

    function maxPerAddressDuringMint() external view returns (uint256);

    function joeFeePercent() external view returns (uint256);

    function joeFeeCollector() external view returns (address);

    function projectOwner() external view returns (address);

    function allowList(address) external view returns (uint256);

    function amountMintedByDevs() external view returns (uint256);

    function initializeJoeFee(uint256 _joeFeePercent, address _joeFeeCollector)
        external;

    function setRoyaltyInfo(address receiver, uint96 feePercent) external;

    function seedAllowlist(
        address[] memory _addresses,
        uint256[] memory _numSlots
    ) external;

    function setBaseURI(string calldata baseURI) external;

    function setUnrevealedURI(string calldata baseURI) external;

    function setProjectOwner(address _projectOwner) external;

    function devMint(uint256 quantity) external;

    function withdrawAVAX(address to) external;

    function revealNextBatch() external;

    function forceReveal() external;

    function hasBatchToReveal() external view returns (bool, uint256);

    function getOwnershipData(uint256 tokenId)
        external
        view
        returns (ERC721AUpgradeable.TokenOwnership memory);

    function numberMinted(address owner) external view returns (uint256);
}
