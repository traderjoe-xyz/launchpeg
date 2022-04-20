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
    uint256 public immutable override collectionSize;

    /// @notice Amount of NFTs reserved for `projectOwner` (e.g 200)
    /// @dev It can be minted any time via `devMint`
    uint256 public immutable override amountForDevs;

    /// @dev Tracks the amount of NFTs minted by `projectOwner`
    uint256 internal amountMintedByDevs;

    /// @notice Max amout of NFTs that can be minted at once
    uint256 public immutable override maxBatchSize;

    /// @notice Max amount of NFTs an address can mint
    uint256 public immutable override maxPerAddressDuringMint;

    /// @notice The fees collected by Joepeg on the sale benefits
    /// @dev in basis points e.g 100 for 1%
    uint256 public override joeFeePercent;

    /// @notice The address to which the fees on the sale will be sent
    address public override joeFeeCollector;

    /// @notice The project owner
    /// @dev We may own the contract during the launch: this address is allowed to call `devMint`
    address public override projectOwner;

    /// @notice Token URI after collection reveal
    string public baseURI;

    /// @notice Token URI before the collection reveal
    string public unrevealedURI;

    /// @notice The amount of NFTs each allowed address can mint during the allowlist mint
    mapping(address => uint256) public override allowlist;

    /// @dev Emitted on initializeJoeFee()
    /// @param feePercent The fees collected by Joepeg on the sale benefits
    /// @param feeCollector The address to which the fees on the sale will be sent
    event JoeFeeInitialized(uint256 feePercent, address feeCollector);

    /// @dev Emitted on devMint()
    /// @param sender The address that minted
    /// @param quantity Amount of NFTs minted
    event DevMint(address indexed sender, uint256 quantity);

    /// @dev Emitted on withdrawAVAX()
    /// @param sender The address that withdrew the tokens
    /// @param amount Amount of AVAX transfered to `sender`
    /// @param fee Amount of AVAX paid to the fee collector
    event AvaxWithdraw(address indexed sender, uint256 amount, uint256 fee);

    /// @dev Emitted on setProjectOwner()
    /// @param owner The new project owner
    event ProjectOwnerUpdated(address indexed owner);

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

    /// @dev BaseLaunchPeg constructor
    /// @param _name ERC721 name
    /// @param _symbol ERC721 symbol
    /// @param _projectOwner The project owner
    /// @param _royaltyReceiver Royalty fee collector
    /// @param _maxBatchSize Max amout of NFTs that can be minted at once
    /// @param _collectionSize The collection size (e.g 10000)
    /// @param _amountForDevs Amount of NFTs reserved for `projectOwner` (e.g 200)
    /// @param _batchRevealSize Size of the batch reveal
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
        if (_collectionSize % _batchRevealSize != 0) {
            revert LaunchPeg__InvalidBatchRevealSize();
        }

        projectOwner = _projectOwner;
        collectionSize = _collectionSize;
        maxBatchSize = _maxBatchSize;
        maxPerAddressDuringMint = _maxBatchSize;
        amountForDevs = _amountForDevs;

        _setDefaultRoyalty(_royaltyReceiver, 500);
    }

    /// @notice Seed the allowlist: each address can mint up to numSlot
    /// @dev e.g _addresses: [0x1, 0x2, 0x3], _numSlots: [1, 1, 2]
    /// @param _addresses Addresses allowed to mint during the allowlist phase
    /// @param _numSlots Quantity of NFTs that an address can mint
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

    /// @notice Initialize the percentage taken on the sale and collector address
    /// @param _joeFeePercent The fees collected by Joepeg on the sale benefits
    /// @param _joeFeeCollector The address to which the fees on the sale will be sent
    function initializeJoeFee(
        uint256 _joeFeePercent,
        address payable _joeFeeCollector
    ) external override onlyOwner {
        if (_joeFeePercent > 10000) {
            revert LaunchPeg__InvalidPercent();
        }
        if (_joeFeeCollector == address(0)) {
            revert LaunchPeg__InvalidJoeFeeCollector();
        }
        joeFeePercent = _joeFeePercent;
        joeFeeCollector = _joeFeeCollector;
        emit JoeFeeInitialized(_joeFeePercent, _joeFeeCollector);
    }

    /// @notice Withdraw Avax to the contract owner
    function withdrawAVAX() external override onlyOwner nonReentrant {
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

        emit AvaxWithdraw(msg.sender, amount, fee);
    }

    /// @notice Returns the number of NFTs minted by a specific address
    /// @param owner The owner of the NFTs
    function numberMinted(address owner)
        public
        view
        override
        returns (uint256)
    {
        return _numberMinted(owner);
    }

    /// @notice Returns the ownership data of a specific token ID
    /// @param tokenId Token ID
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

    /// @notice Set the base URI
    /// @dev Only callable by project owner
    function setBaseURI(string calldata _baseURI) external override onlyOwner {
        baseURI = _baseURI;
    }

    /// @notice Set the unrevealed URI
    /// @dev Only callable by project owner
    function setUnrevealedURI(string calldata _unrevealedURI)
        external
        override
        onlyOwner
    {
        unrevealedURI = _unrevealedURI;
    }

    /// @notice Checks block timestamp, token minted and last token revealed
    /// to know if more token can be revealed
    function hasBatchToReveal() external view override returns (bool, uint256) {
        return _hasBatchToReveal(totalSupply());
    }

    /// @notice Reveals the next batch if the reveal conditions are met
    function revealNextBatch() external override isEOA {
        if (!_revealNextBatch(totalSupply())) {
            revert LaunchPeg__RevealNextBatchNotAvailable();
        }
    }

    /// @notice Allows ProjectOwner to reveal batches even if the conditions are not met
    function forceReveal() external override onlyProjectOwner {
        _forceReveal();
    }

    /// @notice Set the project owner
    /// @dev The project owner can call `devMint` any time
    function setProjectOwner(address _projectOwner)
        external
        override
        onlyOwner
    {
        projectOwner = _projectOwner;
        emit ProjectOwnerUpdated(projectOwner);
    }

    /// @notice Mint NFTs to the project owner
    /// @dev Can only mint up to ``amountForDevs`
    /// @param quantity Quantity of NFTs to mint
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

    /// @notice Returns the Uniform Resource Identifier (URI) for `tokenId` token.
    function tokenURI(uint256 id)
        public
        view
        override(ERC721A, IERC721Metadata)
        returns (string memory)
    {
        if (id >= lastTokenRevealed) {
            return unrevealedURI;
        } else {
            return
                string(
                    abi.encodePacked(
                        baseURI,
                        _getShuffledTokenId(id).toString()
                    )
                );
        }
    }

    /// @notice Set the royalty fee
    /// @param receiver Royalty fee collector
    /// @param feePercent Royalty fee percent in basis point
    function setRoyaltyInfo(address receiver, uint96 feePercent)
        external
        override
        onlyOwner
    {
        _setDefaultRoyalty(receiver, feePercent);
    }

    /// @dev Returns true if this contract implements the interface defined by
    /// `interfaceId`. See the corresponding
    /// https://eips.ethereum.org/EIPS/eip-165#how-interfaces-are-identified[EIP section]
    /// to learn more about how these ids are created.
    /// This function call must use less than 30 000 gas.
    function supportsInterface(bytes4 interfaceId)
        public
        view
        virtual
        override(ERC721A, ERC2981, IERC165)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
