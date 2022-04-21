// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/IERC721Metadata.sol";

import "erc721a/contracts/ERC721A.sol";

/// @title IBaseLaunchPeg
/// @author Trader Joe
/// @notice Defines the basic interface of BaseLaunchPeg
interface IBaseLaunchPeg is IERC721, IERC721Metadata {
    function collectionSize() external view returns (uint256);

    function amountForDevs() external view returns (uint256);

    function maxBatchSize() external view returns (uint256);

    function maxPerAddressDuringMint() external view returns (uint256);

    function joeFeePercent() external view returns (uint256);

    function joeFeeCollector() external view returns (address);

    function projectOwner() external view returns (address);

    function allowlist(address) external view returns (uint256);

    function initializeJoeFee(uint256 _joeFeePercent, address _joeFeeCollector)
        external;

    function seedAllowlist(
        address[] memory _addresses,
        uint256[] memory _numSlots
    ) external;

    function setProjectOwner(address _projectOwner) external;

    function devMint(uint256 quantity) external;

    function withdrawAVAX() external;

    function numberMinted(address owner) external view returns (uint256);

    function getOwnershipData(uint256 tokenId)
        external
        view
        returns (ERC721A.TokenOwnership memory);

    function setBaseURI(string calldata baseURI) external;

    function setUnrevealedURI(string calldata baseURI) external;

    function setRoyaltyInfo(address receiver, uint96 feePercent) external;

    function hasBatchToReveal() external view returns (bool, uint256);

    function revealNextBatch() external;

    function forceReveal() external;
}
