// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/common/ERC2981Upgradeable.sol";
import "@chainlink/contracts/src/v0.8/interfaces/VRFCoordinatorV2Interface.sol";

import "erc721a-upgradeable/contracts/ERC721AUpgradeable.sol";

import "./BatchReveal.sol";
import "./LaunchpegErrors.sol";
import "./interfaces/IBaseLaunchpeg.sol";

/// @title BaseLaunchpeg
/// @author Trader Joe
/// @notice Implements the functionalities shared between Launchpeg and FlatLaunchpeg contracts.
abstract contract BaseLaunchpeg is
    IBaseLaunchpeg,
    ERC721AUpgradeable,
    BatchReveal,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    ERC2981Upgradeable
{
    using StringsUpgradeable for uint256;

    /// @notice The collection size (e.g 10000)
    uint256 public override collectionSize;

    /// @notice Amount of NFTs reserved for `projectOwner` (e.g 200)
    /// @dev It can be minted any time via `devMint`
    uint256 public override amountForDevs;

    /// @notice Amount of NFTs available for the allowlist mint (e.g 1000)
    uint256 public override amountForAllowlist;

    /// @notice Max amount of NFTs that can be minted at once
    uint256 public override maxBatchSize;

    /// @notice Max amount of NFTs an address can mint
    uint256 public override maxPerAddressDuringMint;

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
    string public override baseURI;

    /// @notice Token URI before the collection reveal
    string public override unrevealedURI;

    /// @notice The amount of NFTs each allowed address can mint during the allowlist mint
    mapping(address => uint256) public override allowlist;

    /// @notice Tracks the amount of NFTs minted by `projectOwner`
    uint256 public override amountMintedByDevs;

    /// @notice Tracks the amount of NFTs minted on Allowlist phase
    uint256 public override amountMintedDuringAllowlist;

    /// @notice Tracks the amount of NFTs minted on Public Sale phase
    uint256 public override amountMintedDuringPublicSale;

    /// @notice Start time of the allowlist mint in seconds
    uint256 public override allowlistStartTime;

    /// @notice Start time of the public sale in seconds
    /// @dev A timestamp greater than the allowlist mint start
    uint256 public override publicSaleStartTime;

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
    event BaseURISet(string baseURI);

    /// @dev Emitted on setUnrevealedURI()
    /// @param unrevealedURI The new base URI
    event UnrevealedURISet(string unrevealedURI);

    /// @dev Emitted on seedAllowlist()
    event AllowlistSeeded();

    /// @dev Emitted on _setDefaultRoyalty()
    /// @param receiver Royalty fee collector
    /// @param feePercent Royalty fee percent in basis point
    event DefaultRoyaltySet(address indexed receiver, uint256 feePercent);

    /// @dev emitted on setVRF()
    /// @param _vrfCoordinator Chainlink coordinator address
    /// @param _keyHash Keyhash of the gas lane wanted
    /// @param _subscriptionId Chainlink subscription ID
    /// @param _callbackGasLimit Max gas used by the coordinator callback
    event VRFSet(
        address _vrfCoordinator,
        bytes32 _keyHash,
        uint64 _subscriptionId,
        uint32 _callbackGasLimit
    );

    modifier isEOA() {
        if (tx.origin != msg.sender) {
            revert Launchpeg__Unauthorized();
        }
        _;
    }

    modifier onlyProjectOwner() {
        if (projectOwner != msg.sender) {
            revert Launchpeg__Unauthorized();
        }
        _;
    }

    /// @dev BaseLaunchpeg initialization
    /// @param _name ERC721 name
    /// @param _symbol ERC721 symbol
    /// @param _projectOwner The project owner
    /// @param _royaltyReceiver Royalty fee collector
    /// @param _maxBatchSize Max amount of NFTs that can be minted at once
    /// @param _collectionSize The collection size (e.g 10000)
    /// @param _amountForDevs Amount of NFTs reserved for `projectOwner` (e.g 200)
    /// @param _amountForAllowlist Amount of NFTs available for the allowlist mint (e.g 1000)
    /// @param _batchRevealSize Size of the batch reveal
    function initializeBaseLaunchpeg(
        string memory _name,
        string memory _symbol,
        address _projectOwner,
        address _royaltyReceiver,
        uint256 _maxBatchSize,
        uint256 _collectionSize,
        uint256 _amountForDevs,
        uint256 _amountForAllowlist,
        uint256 _batchRevealSize,
        uint256 _revealStartTime,
        uint256 _revealInterval
    ) internal onlyInitializing {
        __Ownable_init();
        __ReentrancyGuard_init();
        __ERC2981_init();

        __ERC721A_init(_name, _symbol);
        initializeBatchReveal(_batchRevealSize, _collectionSize);

        if (_projectOwner == address(0)) {
            revert Launchpeg__InvalidProjectOwner();
        }

        if (_amountForDevs + _amountForAllowlist > _collectionSize) {
            revert Launchpeg__LargerCollectionSizeNeeded();
        }

        if (_maxBatchSize > _collectionSize) {
            revert Launchpeg__InvalidMaxBatchSize();
        }
        // We assume that if the reveal is more than 100 days in the future, that's a mistake
        // Same if the reveal interval is longer than 10 days
        if (
            _revealStartTime > block.timestamp + 8_640_000 ||
            _revealInterval > 864_000
        ) {
            revert Launchpeg__InvalidRevealDates();
        }

        projectOwner = _projectOwner;
        // Default royalty is 5%
        _setDefaultRoyalty(_royaltyReceiver, 500);

        maxBatchSize = _maxBatchSize;
        collectionSize = _collectionSize;
        maxPerAddressDuringMint = _maxBatchSize;
        amountForDevs = _amountForDevs;
        amountForAllowlist = _amountForAllowlist;

        revealStartTime = _revealStartTime;
        revealInterval = _revealInterval;
    }

    /// @notice Initialize the sales fee percent taken by Joepegs and address that collects the fees
    /// @param _joeFeePercent The fees collected by Joepegs on the sale benefits
    /// @param _joeFeeCollector The address to which the fees on the sale will be sent
    function initializeJoeFee(uint256 _joeFeePercent, address _joeFeeCollector)
        external
        override
        onlyOwner
    {
        if (joeFeeCollector != address(0)) {
            revert Launchpeg__JoeFeeAlreadyInitialized();
        }
        if (_joeFeePercent > BASIS_POINT_PRECISION) {
            revert Launchpeg__InvalidPercent();
        }
        if (_joeFeeCollector == address(0)) {
            revert Launchpeg__InvalidJoeFeeCollector();
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
        // Royalty fees are limited to 25%
        if (_feePercent > 2_500) {
            revert Launchpeg__InvalidRoyaltyInfo();
        }
        _setDefaultRoyalty(_receiver, _feePercent);
        emit DefaultRoyaltySet(_receiver, _feePercent);
    }

    /// @notice Set amount of NFTs mintable per address during the allowlist phase
    /// @param _addresses List of addresses allowed to mint during the allowlist phase
    /// @param _numNfts List of NFT quantities mintable per address
    function seedAllowlist(
        address[] calldata _addresses,
        uint256[] calldata _numNfts
    ) external override onlyOwner {
        uint256 addressesLength = _addresses.length;
        if (addressesLength != _numNfts.length) {
            revert Launchpeg__WrongAddressesAndNumSlotsLength();
        }
        for (uint256 i; i < addressesLength; i++) {
            allowlist[_addresses[i]] = _numNfts[i];
        }

        emit AllowlistSeeded();
    }

    /// @notice Set the base URI
    /// @dev This sets the URI for revealed tokens
    /// Only callable by project owner
    /// @param _baseURI Base URI to be set
    function setBaseURI(string calldata _baseURI) external override onlyOwner {
        baseURI = _baseURI;
        emit BaseURISet(baseURI);
    }

    /// @notice Set the unrevealed URI
    /// @dev Only callable by project owner
    /// @param _unrevealedURI Unrevealed URI to be set
    function setUnrevealedURI(string calldata _unrevealedURI)
        external
        override
        onlyOwner
    {
        unrevealedURI = _unrevealedURI;
        emit UnrevealedURISet(unrevealedURI);
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
            revert Launchpeg__InvalidProjectOwner();
        }

        projectOwner = _projectOwner;
        emit ProjectOwnerUpdated(projectOwner);
    }

    /// @notice Set VRF configuration
    /// @param _vrfCoordinator Chainlink coordinator address
    /// @param _keyHash Keyhash of the gas lane wanted
    /// @param _subscriptionId Chainlink subscription ID
    /// @param _callbackGasLimit Max gas used by the coordinator callback
    function setVRF(
        address _vrfCoordinator,
        bytes32 _keyHash,
        uint64 _subscriptionId,
        uint32 _callbackGasLimit
    ) external override onlyOwner {
        if (_vrfCoordinator == address(0)) {
            revert Launchpeg__InvalidCoordinator();
        }

        (
            ,
            uint32 _maxGasLimit,
            bytes32[] memory s_provingKeyHashes
        ) = VRFCoordinatorV2Interface(_vrfCoordinator).getRequestConfig();

        // 20_000 is the cost of storing one word, callback cost will never be lower than that
        if (_callbackGasLimit > _maxGasLimit || _callbackGasLimit < 20_000) {
            revert Launchpeg__InvalidCallbackGasLimit();
        }

        bool keyHashFound;
        for (uint256 i; i < s_provingKeyHashes.length; i++) {
            if (s_provingKeyHashes[i] == _keyHash) {
                keyHashFound = true;
                break;
            }
        }

        if (!keyHashFound) {
            revert Launchpeg__InvalidKeyHash();
        }

        (, , , address[] memory consumers) = VRFCoordinatorV2Interface(
            _vrfCoordinator
        ).getSubscription(_subscriptionId);

        bool isInConsumerList;
        for (uint256 i; i < consumers.length; i++) {
            if (consumers[i] == address(this)) {
                isInConsumerList = true;
                break;
            }
        }

        if (!isInConsumerList) {
            revert Launchpeg__IsNotInTheConsumerList();
        }

        useVRF = true;
        setVRFConsumer(_vrfCoordinator);
        keyHash = _keyHash;
        subscriptionId = _subscriptionId;
        callbackGasLimit = _callbackGasLimit;

        emit VRFSet(
            _vrfCoordinator,
            _keyHash,
            _subscriptionId,
            _callbackGasLimit
        );
    }

    /// @notice Mint NFTs to the project owner
    /// @dev Can only mint up to `amountForDevs`
    /// @param _quantity Quantity of NFTs to mint
    function devMint(uint256 _quantity) external override onlyProjectOwner {
        if (totalSupply() + _quantity > collectionSize) {
            revert Launchpeg__MaxSupplyReached();
        }
        if (amountMintedByDevs + _quantity > amountForDevs) {
            revert Launchpeg__MaxSupplyForDevReached();
        }
        if (_quantity % maxBatchSize != 0) {
            revert Launchpeg__CanOnlyMintMultipleOfMaxBatchSize();
        }
        amountMintedByDevs = amountMintedByDevs + _quantity;
        uint256 numChunks = _quantity / maxBatchSize;
        for (uint256 i; i < numChunks; i++) {
            _mint(msg.sender, maxBatchSize, "", false);
        }
        emit DevMint(msg.sender, _quantity);
    }

    /// @notice Withdraw AVAX to the contract owner
    /// @param _to Recipient of the earned AVAX
    function withdrawAVAX(address _to)
        external
        override
        onlyOwner
        nonReentrant
    {
        uint256 amount = address(this).balance;
        uint256 fee;
        bool sent;

        if (joeFeePercent > 0) {
            fee = (amount * joeFeePercent) / BASIS_POINT_PRECISION;
            amount = amount - fee;

            (sent, ) = joeFeeCollector.call{value: fee}("");
            if (!sent) {
                revert Launchpeg__TransferFailed();
            }
        }

        (sent, ) = _to.call{value: amount}("");
        if (!sent) {
            revert Launchpeg__TransferFailed();
        }

        emit AvaxWithdraw(_to, amount, fee);
    }

    /// @notice Reveals the next batch if the reveal conditions are met
    function revealNextBatch() external override isEOA {
        if (!_revealNextBatch(totalSupply())) {
            revert Launchpeg__RevealNextBatchNotAvailable();
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
    /// @return URI Token URI
    function tokenURI(uint256 _id)
        public
        view
        override(ERC721AUpgradeable, IERC721MetadataUpgradeable)
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
    /// to learn more about how these IDs are created.
    /// This function call must use less than 30 000 gas.
    /// @param _interfaceId InterfaceId to consider. Comes from type(InterfaceContract).interfaceId
    /// @return isInterfaceSupported True if the considered interface is supported
    function supportsInterface(bytes4 _interfaceId)
        public
        view
        virtual
        override(ERC721AUpgradeable, ERC2981Upgradeable, IERC165Upgradeable)
        returns (bool)
    {
        return
            ERC721AUpgradeable.supportsInterface(_interfaceId) ||
            ERC2981Upgradeable.supportsInterface(_interfaceId) ||
            ERC165Upgradeable.supportsInterface(_interfaceId) ||
            super.supportsInterface(_interfaceId);
    }

    /// @dev Verifies that enough AVAX has been sent by the sender and refunds the extra tokens if any
    /// @param _price The price paid by the sender for minting NFTs
    function _refundIfOver(uint256 _price) internal {
        if (msg.value < _price) {
            revert Launchpeg__NotEnoughAVAX(msg.value);
        }
        if (msg.value > _price) {
            (bool success, ) = msg.sender.call{value: msg.value - _price}("");
            if (!success) {
                revert Launchpeg__TransferFailed();
            }
        }
    }
}
