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

    /// @notice Max amount of NFTs that can be minted at once
    uint256 public immutable override maxBatchSize;

    /// @notice Max amount of NFTs an address can mint
    uint256 public immutable override maxPerAddressDuringMint;

    /// @notice The fees collected by Joepegs on the sale benefits
    /// @dev In basis points e.g 100 for 1%
    uint256 public override joeFeePercent;

    /// @notice The address to which the fees on the sale will be sent
    address public override joeFeeCollector;

    /// @notice Percentage base point
    uint256 public constant BASIS_POINT_PRECISION = 10_000;

    /// @notice The project owner
    /// @dev We may own the contract during the launch; this address is allowed to call `devMint`
    address public override projectOwner;

    /// @notice Token URI after collection reveal
    string public baseURI;

    /// @notice Token URI before the collection reveal
    string public unrevealedURI;

    /// @notice The amount of NFTs each allowed address can mint during the allowlist mint
    mapping(address => uint256) public override allowlist;

    /// @dev Tracks the amount of NFTs minted by `projectOwner`
    uint256 internal _amountMintedByDevs;

    /// @dev Emitted on initializeJoeFee()
    /// @param feePercent The fees collected by Joepegs on the sale benefits
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

    /// @dev Emitted on setBaseURI()
    /// @param baseURI The new base URI
    event BaseUriSet(string baseURI);

    /// @dev Emitted on setUnrevealedURI()
    /// @param unrevealedURI The new base URI
    event UnrevealedUriSet(string unrevealedURI);

    /// @dev Emitted on seedAllowlist()
    event AllowlistSeeded();

    /// @dev Emitted on _setDefaultRoyalty()
    /// @param receiver Royalty fee collector
    /// @param feePercent Royalty fee percent in basis point
    event DefaultRoyaltySet(address indexed receiver, uint256 feePercent);

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
    /// @param _maxBatchSize Max amount of NFTs that can be minted at once
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

        if (_projectOwner == address(0)) {
            revert LaunchPeg__InvalidProjectOwner();
        }

        if (_amountForDevs > _collectionSize) {
            revert LaunchPeg__LargerCollectionSizeNeeded();
        }

        projectOwner = _projectOwner;
        // Default royalty is 5%
        _setDefaultRoyalty(_royaltyReceiver, 500);

        maxBatchSize = _maxBatchSize;
        collectionSize = _collectionSize;
        maxPerAddressDuringMint = _maxBatchSize;
        amountForDevs = _amountForDevs;
    }

    /// @notice Initialize the sales fee percent taken by Joepegs and address that collects the fees
    /// @param _joeFeePercent The fees collected by Joepegs on the sale benefits
    /// @param _joeFeeCollector The address to which the fees on the sale will be sent
    function initializeJoeFee(uint256 _joeFeePercent, address _joeFeeCollector)
        external
        override
        onlyOwner
    {
        if (_joeFeePercent > BASIS_POINT_PRECISION) {
            revert LaunchPeg__InvalidPercent();
        }
        if (_joeFeeCollector == address(0)) {
            revert LaunchPeg__InvalidJoeFeeCollector();
        }
        joeFeePercent = _joeFeePercent;
        joeFeeCollector = _joeFeeCollector;
        emit JoeFeeInitialized(_joeFeePercent, _joeFeeCollector);
    }

    /// @notice Set the royalty fee
    /// @param _receiver Royalty fee collector
    /// @param _feePercent Royalty fee percent in basis point
    function setRoyaltyInfo(address _receiver, uint96 _feePercent)
        external
        override
        onlyOwner
    {
        _setDefaultRoyalty(_receiver, _feePercent);
        emit DefaultRoyaltySet(_receiver, _feePercent);
    }

    /// @notice Set amount of NFTs mintable per address during the allowlist phase
    /// @param _addresses List of addresses allowed to mint during the allowlist phase
    /// @param _numNfts List of NFT quantities mintable per address
    function seedAllowlist(
        address[] memory _addresses,
        uint256[] memory _numNfts
    ) external override onlyOwner {
        uint256 addressesLength = _addresses.length;
        if (addressesLength != _numNfts.length) {
            revert LaunchPeg__WrongAddressesAndNumSlotsLength();
        }
        for (uint256 i = 0; i < addressesLength; i++) {
            allowlist[_addresses[i]] = _numNfts[i];
        }

        emit AllowlistSeeded();
    }

    /// @notice Set the base URI
    /// @dev This sets the URI for revealed tokens
    /// Only callable by project owner
    function setBaseURI(string calldata _baseURI) external override onlyOwner {
        baseURI = _baseURI;
        emit BaseUriSet(baseURI);
    }

    /// @notice Set the unrevealed URI
    /// @dev Only callable by project owner
    function setUnrevealedURI(string calldata _unrevealedURI)
        external
        override
        onlyOwner
    {
        unrevealedURI = _unrevealedURI;
        emit UnrevealedUriSet(unrevealedURI);
    }

    /// @notice Set the project owner
    /// @dev The project owner can call `devMint` any time
    /// @param _projectOwner The project owner
    function setProjectOwner(address _projectOwner)
        external
        override
        onlyOwner
    {
        if (_projectOwner == address(0)) {
            revert LaunchPeg__InvalidProjectOwner();
        }

        projectOwner = _projectOwner;
        emit ProjectOwnerUpdated(projectOwner);
    }

    /// @notice Mint NFTs to the project owner
    /// @dev Can only mint up to `amountForDevs`
    /// @param _quantity Quantity of NFTs to mint
    function devMint(uint256 _quantity) external override onlyProjectOwner {
        if (_amountMintedByDevs + _quantity > amountForDevs) {
            revert LaunchPeg__MaxSupplyReached();
        }
        if (_quantity % maxBatchSize != 0) {
            revert LaunchPeg__CanOnlyMintMultipleOfMaxBatchSize();
        }
        _amountMintedByDevs = _amountMintedByDevs + _quantity;
        uint256 numChunks = _quantity / maxBatchSize;
        for (uint256 i = 0; i < numChunks; i++) {
            _mint(msg.sender, maxBatchSize, "", false);
        }
        emit DevMint(msg.sender, _quantity);
    }

    /// @notice Withdraw AVAX to the contract owner
    function withdrawAVAX() external override onlyOwner nonReentrant {
        uint256 amount = address(this).balance;
        uint256 fee = 0;
        bool sent = false;

        if (joeFeePercent > 0) {
            fee = (amount * joeFeePercent) / BASIS_POINT_PRECISION;
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

    /// @notice Tells you if a batch can be revealed
    /// @return bool Whether reveal can be triggered or not
    /// @return uint256 The number of the next batch that will be revealed
    function hasBatchToReveal() external view override returns (bool, uint256) {
        return _hasBatchToReveal(totalSupply());
    }

    /// @notice Returns the ownership data of a specific token ID
    /// @param _tokenId Token ID
    /// @return TokenOwnership Ownership struct for a specific token ID
    function getOwnershipData(uint256 _tokenId)
        external
        view
        override
        returns (TokenOwnership memory)
    {
        return _ownershipOf(_tokenId);
    }

    /// @notice Returns the Uniform Resource Identifier (URI) for `tokenId` token.
    /// @param _id Token id
    /// @return URI IPFS token URI
    function tokenURI(uint256 _id)
        public
        view
        override(ERC721A, IERC721Metadata)
        returns (string memory)
    {
        if (_id >= lastTokenRevealed) {
            return unrevealedURI;
        } else {
            return
                string(
                    abi.encodePacked(
                        baseURI,
                        _getShuffledTokenId(_id).toString()
                    )
                );
        }
    }

    /// @notice Returns the number of NFTs minted by a specific address
    /// @param _owner The owner of the NFTs
    /// @return numberMinted Number of NFTs minted
    function numberMinted(address _owner)
        public
        view
        override
        returns (uint256)
    {
        return _numberMinted(_owner);
    }

    /// @dev Returns true if this contract implements the interface defined by
    /// `interfaceId`. See the corresponding
    /// https://eips.ethereum.org/EIPS/eip-165#how-interfaces-are-identified[EIP section]
    /// to learn more about how these ids are created.
    /// This function call must use less than 30 000 gas.
    /// @param _interfaceId InterfaceId to consider. Comes from type(InterfaceContract).interfaceId
    /// @return isInterfaceSupported True if the considered interface is supported
    function supportsInterface(bytes4 _interfaceId)
        public
        view
        virtual
        override(ERC721A, ERC2981, IERC165)
        returns (bool)
    {
        return super.supportsInterface(_interfaceId);
    }

    /// @dev Verifies that enough AVAX has been sent by the sender and refunds the extra tokens if any
    /// @param _price The price paid by the sender for minting NFTs
    function _refundIfOver(uint256 _price) internal {
        if (msg.value < _price) {
            revert LaunchPeg__NotEnoughAVAX(msg.value);
        }
        if (msg.value > _price) {
            (bool success, ) = msg.sender.call{value: msg.value - _price}("");
            if (!success) {
                revert LaunchPeg__TransferFailed();
            }
        }
    }
}
