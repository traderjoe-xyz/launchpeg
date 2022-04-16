// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";

import "erc721a/contracts/ERC721A.sol";

import "./interfaces/IBaseLaunchPeg.sol";
import "./LaunchPegErrors.sol";
import "./BatchReveal.sol";

/// @title BaseLaunchPeg
/// @author Trader Joe
/// @notice Implements the functionalities shared between LaunchPeg and FlatLaunchPeg contracts.
abstract contract BaseLaunchPeg is
    ERC721A,
    Ownable,
    ReentrancyGuard,
    IBaseLaunchPeg,
    BatchReveal,
    ERC2981
{
    using Strings for uint256;

    /// @notice The collection size (e.g 10000)
    uint256 public immutable collectionSize;

    /// @notice Amount of NFTs reserved for `projectOwner` (e.g 200)
    /// @dev It can be minted any time via `devMint`
    uint256 public immutable amountForDevs;

    /// @dev Tracks the amount of NFTs minted by `projectOwner`
    uint256 internal amountMintedByDevs;

    /// @notice Max amout of NFTs that can be minted at once
    uint256 public immutable maxBatchSize;

    /// @notice Max amount of NFTs an address can mint
    uint256 public immutable maxPerAddressDuringMint;

    /// @notice The fees collected by Joepeg on the sale benefits
    /// @dev in basis points e.g 100 for 1%
    uint256 public joeFeePercent;

    /// @notice The address to which the fees on the sale will be sent
    address public joeFeeCollector;

    /// @notice The project owner
    /// @dev We may own the contract during the launch: this address is allowed to call `devMint`
    address public projectOwner;

    /// @dev Token URI after collection reveal
    string private _baseTokenURI;

    /// @dev Token URI before the collection reveal
    string private _unrevealedTokenURI;

    /// @notice The amount of NFTs each allowed address can mint during the allowlist mint
    mapping(address => uint256) public allowlist;

    modifier isEOA() {
        if (tx.origin != msg.sender) {
            revert LaunchPeg__Unauthorized();
        }
        _;
    }

    modifier onlyProjectOwner() {
        if (projectOwner != msg.sender) {
            revert LaunchPeg__Unauthorized();
        }
        _;
    }

    constructor(
        string memory _name,
        string memory _symbol,
        address _projectOwner,
        address _royaltyReceiver,
        uint256 _maxBatchSize,
        uint256 _collectionSize,
        uint256 _amountForDevs,
        uint256 _batchRevealSize
    ) ERC721A(_name, _symbol) BatchReveal(_batchRevealSize, _collectionSize) {
        if (_collectionSize % _batchRevealSize > 0) {
            revert LaunchPeg__InvalidBatchRevealSize();
        }

        projectOwner = _projectOwner;
        collectionSize = _collectionSize;
        maxBatchSize = _maxBatchSize;
        maxPerAddressDuringMint = _maxBatchSize;
        amountForDevs = _amountForDevs;

        _setDefaultRoyalty(_royaltyReceiver, 500);
    }

    /// @inheritdoc IBaseLaunchPeg
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

    /// @inheritdoc IBaseLaunchPeg
    function initializeJoeFee(
        uint256 _joeFeePercent,
        address payable _joeFeeCollector
    ) external override onlyOwner {
        if (joeFeePercent > 10000) {
            revert LaunchPeg__InvalidPercent();
        }
        if (_joeFeeCollector == address(0)) {
            revert LaunchPeg__InvalidJoeFeeCollector();
        }
        joeFeePercent = _joeFeePercent;
        joeFeeCollector = _joeFeeCollector;
        emit JoeFeeInitialized(_joeFeePercent, _joeFeeCollector);
    }

    /// @inheritdoc IBaseLaunchPeg
    function withdrawMoney() external override onlyOwner nonReentrant {
        uint256 amount = address(this).balance;
        uint256 fee = 0;
        bool sent = false;

        if (joeFeePercent > 0) {
            fee = (amount * joeFeePercent) / 10000;
            amount = amount - fee;

            (sent, ) = joeFeeCollector.call{value: fee}("");
            if (!sent) {
                revert LaunchPeg__TransferFailed();
            }
        }

        (sent, ) = msg.sender.call{value: amount}("");
        if (!sent) {
            revert LaunchPeg__TransferFailed();
        }

        emit MoneyWithdraw(msg.sender, amount, fee);
    }

    /// @inheritdoc IBaseLaunchPeg
    function numberMinted(address owner)
        public
        view
        override
        returns (uint256)
    {
        return _numberMinted(owner);
    }

    /// @inheritdoc IBaseLaunchPeg
    function getOwnershipData(uint256 tokenId)
        external
        view
        override
        returns (TokenOwnership memory)
    {
        return _ownershipOf(tokenId);
    }

    /// @dev Verifies that enough AVAX has been sent by the sender and refunds the extra tokens if any
    /// @param _price The price paid by the sender for minting NFTs
    function refundIfOver(uint256 _price) internal {
        if (msg.value < _price) {
            revert LaunchPeg__NotEnoughAVAX(msg.value);
        }
        if (msg.value > _price) {
            (bool success, ) = payable(msg.sender).call{
                value: msg.value - _price
            }("");
            if (!success) {
                revert LaunchPeg__TransferFailed();
            }
        }
    }

    /// @dev Returns the base token URI
    function _baseURI() internal view virtual override returns (string memory) {
        return _baseTokenURI;
    }

    /// @inheritdoc IBaseLaunchPeg
    function setBaseURI(string calldata baseURI) external override onlyOwner {
        _baseTokenURI = baseURI;
    }

    /// @dev Returns the unrevealed token URI
    function _unrevealedURI() internal view virtual returns (string memory) {
        return _unrevealedTokenURI;
    }

    /// @inheritdoc IBaseLaunchPeg
    function setUnrevealedURI(string calldata unrevealedURI)
        external
        override
        onlyOwner
    {
        _unrevealedTokenURI = unrevealedURI;
    }

    /// @inheritdoc IBaseLaunchPeg
    function hasBatchToReveal() external view override returns (bool, uint256) {
        return _hasBatchToReveal(totalSupply());
    }

    /// @inheritdoc IBaseLaunchPeg
    function revealNextBatch() external override isEOA {
        if (!_revealNextBatch(totalSupply())) {
            revert LaunchPeg__RevealNextBatchNotAvailable();
        }
    }

    /// @inheritdoc IBaseLaunchPeg
    function forceReveal() external override onlyProjectOwner {
        _forceReveal();
    }

    /// @inheritdoc IBaseLaunchPeg
    function setProjectOwner(address _projectOwner)
        external
        override
        onlyOwner
    {
        projectOwner = _projectOwner;
        emit ProjectOwnerUpdated(projectOwner);
    }

    /// @inheritdoc IBaseLaunchPeg
    function devMint(uint256 quantity) external override onlyProjectOwner {
        if (amountMintedByDevs + quantity > amountForDevs) {
            revert LaunchPeg__MaxSupplyReached();
        }
        if (quantity % maxBatchSize != 0) {
            revert LaunchPeg__CanOnlyMintMultipleOfMaxBatchSize();
        }
        uint256 numChunks = quantity / maxBatchSize;
        for (uint256 i = 0; i < numChunks; i++) {
            _safeMint(msg.sender, maxBatchSize);
        }
        amountMintedByDevs = amountMintedByDevs + quantity;
        emit DevMint(msg.sender, quantity);
    }

    /// @inheritdoc ERC721A
    function tokenURI(uint256 id)
        public
        view
        override(ERC721A, IERC721Metadata)
        returns (string memory)
    {
        if (id >= lastTokenRevealed) {
            return _unrevealedTokenURI;
        } else {
            return
                string(
                    abi.encodePacked(
                        _baseTokenURI,
                        _getShuffledTokenId(id).toString()
                    )
                );
        }
    }

    /// @inheritdoc IBaseLaunchPeg
    function setRoyaltyInfo(address receiver, uint96 feePercent)
        external
        override
        onlyOwner
    {
        _setDefaultRoyalty(receiver, feePercent);
    }

    /// @inheritdoc ERC721A
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721A, ERC2981, IERC165)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
