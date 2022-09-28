// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/common/ERC2981Upgradeable.sol";
import "@chainlink/contracts/src/v0.8/interfaces/VRFCoordinatorV2Interface.sol";

import "erc721a-upgradeable/contracts/ERC721AUpgradeable.sol";

import "./LaunchpegErrors.sol";
import "./interfaces/IBaseLaunchpeg.sol";
import "./interfaces/IBatchReveal.sol";
import "./utils/SafePausableUpgradeable.sol";

/// @title BaseLaunchpeg
/// @author Trader Joe
/// @notice Implements the functionalities shared between Launchpeg and FlatLaunchpeg contracts.
abstract contract BaseLaunchpeg is
    IBaseLaunchpeg,
    ERC721AUpgradeable,
    SafePausableUpgradeable,
    ReentrancyGuardUpgradeable,
    ERC2981Upgradeable
{
    using StringsUpgradeable for uint256;

    IBatchReveal public batchReveal;

    /// @notice Role granted to project owners
    bytes32 public constant override PROJECT_OWNER_ROLE =
        keccak256("PROJECT_OWNER_ROLE");

    /// @notice The collection size (e.g 10000)
    uint256 public override collectionSize;

    /// @notice Amount of NFTs reserved for the project owner (e.g 200)
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

    /// @notice Token URI after collection reveal
    string public override baseURI;

    /// @notice Token URI before the collection reveal
    string public override unrevealedURI;

    /// @notice The amount of NFTs each allowed address can mint during
    /// the pre-mint or allowlist mint
    mapping(address => uint256) public override allowlist;

    // @notice The remaining no. of pre-minted NFTs for the user address
    mapping(address => uint256) public override userAddressToPreMintAmount;

    /// @notice Tracks the amount of NFTs minted by `projectOwner`
    uint256 public override amountMintedByDevs;

    /// @notice Tracks the amount of NFTs minted in the Pre-Mint phase
    uint256 public override amountMintedDuringPreMint;

    /// @notice Tracks the amount of NFTs batch minted
    uint256 public override amountBatchMinted;

    /// @notice Tracks the amount of NFTs minted on Allowlist phase
    uint256 public override amountMintedDuringAllowlist;

    /// @notice Tracks the amount of NFTs minted on Public Sale phase
    uint256 public override amountMintedDuringPublicSale;

    /// @notice Start time of the pre-mint in seconds
    uint256 public override preMintStartTime;

    /// @notice Start time of the allowlist mint in seconds
    uint256 public override allowlistStartTime;

    /// @notice Start time of the public sale in seconds
    /// @dev A timestamp greater than the allowlist mint start
    uint256 public override publicSaleStartTime;

    /// @notice End time of the public sale in seconds
    /// @dev A timestamp greater than the public sale start
    uint256 public override publicSaleEndTime;

    /// @notice Start time when funds can be withdrawn
    uint256 public override withdrawAVAXStartTime;

    /// @dev Queue of pre-mint requests by allowlist users
    PreMintData[] private preMintQueue;

    /// @dev Next index of the `preMintQueue` to be processed by batch mint
    uint256 private preMintQueueIdx;

    struct PreMintData {
        address sender;
        uint256 quantity;
    }

    /// @dev Emitted on initializeJoeFee()
    /// @param feePercent The fees collected by Joepegs on the sale benefits
    /// @param feeCollector The address to which the fees on the sale will be sent
    event JoeFeeInitialized(uint256 feePercent, address feeCollector);

    /// @dev Emitted on devMint()
    /// @param sender The address that minted
    /// @param quantity Amount of NFTs minted
    event DevMint(address indexed sender, uint256 quantity);

    /// @dev Emitted on preMint()
    /// @param sender The address that minted
    /// @param quantity Amount of NFTs minted
    /// @param price Price of 1 NFT
    event PreMint(address indexed sender, uint256 quantity, uint256 price);

    /// @dev Emitted on auctionMint(), batchMintPreMintedNFTs(),
    /// allowlistMint(), publicSaleMint()
    /// @param sender The address that minted
    /// @param quantity Amount of NFTs minted
    /// @param price Price in AVAX for the NFTs
    /// @param startTokenId The token ID of the first minted NFT:
    /// if `startTokenId` = 100 and `quantity` = 2, `sender` minted 100 and 101
    /// @param phase The phase in which the mint occurs
    event Mint(
        address indexed sender,
        uint256 quantity,
        uint256 price,
        uint256 startTokenId,
        Phase phase
    );

    /// @dev Emitted on withdrawAVAX()
    /// @param sender The address that withdrew the tokens
    /// @param amount Amount of AVAX transfered to `sender`
    /// @param fee Amount of AVAX paid to the fee collector
    event AvaxWithdraw(address indexed sender, uint256 amount, uint256 fee);

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

    /// @dev Emitted on setPreMintStartTime()
    /// @param preMintStartTime New pre-mint start time
    event PreMintStartTimeSet(uint256 preMintStartTime);

    /// @dev Emitted on setAllowlistStartTime()
    /// @param allowlistStartTime New allowlist start time
    event AllowlistStartTimeSet(uint256 allowlistStartTime);

    /// @dev Emitted on setPublicSaleStartTime()
    /// @param publicSaleStartTime New public sale start time
    event PublicSaleStartTimeSet(uint256 publicSaleStartTime);

    /// @dev Emitted on setPublicSaleEndTime()
    /// @param publicSaleEndTime New public sale end time
    event PublicSaleEndTimeSet(uint256 publicSaleEndTime);

    /// @dev Emitted on setWithdrawAVAXStartTime()
    /// @param withdrawAVAXStartTime New withdraw AVAX start time
    event WithdrawAVAXStartTimeSet(uint256 withdrawAVAXStartTime);

    modifier isEOA() {
        if (tx.origin != msg.sender) {
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
    function initializeBaseLaunchpeg(
        string memory _name,
        string memory _symbol,
        address _projectOwner,
        address _royaltyReceiver,
        uint256 _maxBatchSize,
        uint256 _collectionSize,
        uint256 _amountForDevs,
        uint256 _amountForAllowlist
    ) internal onlyInitializing {
        __SafePausable_init();
        __ReentrancyGuard_init();
        __ERC2981_init();
        __ERC721A_init(_name, _symbol);

        if (_projectOwner == address(0)) {
            revert Launchpeg__InvalidProjectOwner();
        }

        if (
            _collectionSize == 0 ||
            _amountForDevs + _amountForAllowlist > _collectionSize
        ) {
            revert Launchpeg__LargerCollectionSizeNeeded();
        }

        if (_maxBatchSize > _collectionSize) {
            revert Launchpeg__InvalidMaxBatchSize();
        }

        grantRole(PROJECT_OWNER_ROLE, _projectOwner);
        // Default royalty is 5%
        _setDefaultRoyalty(_royaltyReceiver, 500);

        maxBatchSize = _maxBatchSize;
        collectionSize = _collectionSize;
        maxPerAddressDuringMint = _maxBatchSize;
        amountForDevs = _amountForDevs;
        amountForAllowlist = _amountForAllowlist;
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

    /// @notice Set the allowlist start time. Can only be set after phases
    /// have been initialized.
    /// @dev Only callable by owner
    /// @param _allowlistStartTime New allowlist start time
    function setAllowlistStartTime(uint256 _allowlistStartTime)
        external
        override
        onlyOwner
    {
        if (allowlistStartTime == 0) {
            revert Launchpeg__NotInitialized();
        }
        if (_allowlistStartTime < preMintStartTime) {
            revert Launchpeg__AllowlistBeforePreMint();
        }
        if (publicSaleStartTime < _allowlistStartTime) {
            revert Launchpeg__PublicSaleBeforeAllowlist();
        }
        allowlistStartTime = _allowlistStartTime;
        emit AllowlistStartTimeSet(_allowlistStartTime);
    }

    /// @notice Set the public sale start time. Can only be set after phases
    /// have been initialized.
    /// @dev Only callable by owner
    /// @param _publicSaleStartTime New public sale start time
    function setPublicSaleStartTime(uint256 _publicSaleStartTime)
        external
        override
        onlyOwner
    {
        if (publicSaleStartTime == 0) {
            revert Launchpeg__NotInitialized();
        }
        if (_publicSaleStartTime < allowlistStartTime) {
            revert Launchpeg__PublicSaleBeforeAllowlist();
        }
        if (publicSaleEndTime < _publicSaleStartTime) {
            revert Launchpeg__PublicSaleEndBeforePublicSaleStart();
        }
        publicSaleStartTime = _publicSaleStartTime;
        emit PublicSaleStartTimeSet(_publicSaleStartTime);
    }

    /// @notice Set the public sale end time. Can only be set after phases
    /// have been initialized.
    /// @dev Only callable by owner
    /// @param _publicSaleEndTime New public sale end time
    function setPublicSaleEndTime(uint256 _publicSaleEndTime)
        external
        override
        onlyOwner
    {
        if (publicSaleEndTime == 0) {
            revert Launchpeg__NotInitialized();
        }
        if (_publicSaleEndTime < publicSaleStartTime) {
            revert Launchpeg__PublicSaleEndBeforePublicSaleStart();
        }
        publicSaleEndTime = _publicSaleEndTime;
        emit PublicSaleEndTimeSet(_publicSaleEndTime);
    }

    /// @notice Set the withdraw AVAX start time.
    /// @param _withdrawAVAXStartTime New public sale end time
    function setWithdrawAVAXStartTime(uint256 _withdrawAVAXStartTime)
        external
        override
        onlyOwner
    {
        if (_withdrawAVAXStartTime < block.timestamp) {
            revert Launchpeg__InvalidStartTime();
        }
        withdrawAVAXStartTime = _withdrawAVAXStartTime;
        emit WithdrawAVAXStartTimeSet(_withdrawAVAXStartTime);
    }

    /// @notice Update batch reveal
    /// @dev Can be set to zero address to disable batch reveal
    function setBatchReveal(address _batchReveal) external override onlyOwner {
        batchReveal = IBatchReveal(_batchReveal);
    }

    /// @notice Mint NFTs to the project owner
    /// @dev Can only mint up to `amountForDevs`
    /// @param _quantity Quantity of NFTs to mint
    function devMint(uint256 _quantity)
        external
        override
        onlyOwnerOrRole(PROJECT_OWNER_ROLE)
        whenNotPaused
    {
        if (_totalSupplyWithPreMint() + _quantity > collectionSize) {
            revert Launchpeg__MaxSupplyReached();
        }
        if (amountMintedByDevs + _quantity > amountForDevs) {
            revert Launchpeg__MaxSupplyForDevReached();
        }
        amountMintedByDevs = amountMintedByDevs + _quantity;
        uint256 numChunks = _quantity / maxBatchSize;
        for (uint256 i; i < numChunks; i++) {
            _mint(msg.sender, maxBatchSize, "", false);
        }
        uint256 remainingQty = _quantity % maxBatchSize;
        if (remainingQty != 0) {
            _mint(msg.sender, remainingQty, "", false);
        }
        emit DevMint(msg.sender, _quantity);
    }

    /// @dev Should only be called in the pre-mint phase
    /// @param _quantity Quantity of NFTs to mint
    function _preMint(uint256 _quantity) internal {
        if (_quantity == 0) {
            revert Launchpeg__InvalidQuantity();
        }
        if (_quantity > allowlist[msg.sender]) {
            revert Launchpeg__NotEligibleForAllowlistMint();
        }
        if (
            (_totalSupplyWithPreMint() + _quantity > collectionSize) ||
            (amountMintedDuringPreMint + _quantity > amountForAllowlist)
        ) {
            revert Launchpeg__MaxSupplyReached();
        }
        allowlist[msg.sender] -= _quantity;
        userAddressToPreMintAmount[msg.sender] += _quantity;
        amountMintedDuringPreMint += _quantity;
        preMintQueue.push(
            PreMintData({sender: msg.sender, quantity: _quantity})
        );
        uint256 price = _preMintPrice();
        uint256 totalCost = price * _quantity;
        emit PreMint(msg.sender, _quantity, price);
        _refundIfOver(totalCost);
    }

    /// @dev Should only be called in the allowlist and public sale phases.
    /// @param _maxQuantity Max quantity of NFTs to mint
    function _batchMintPreMintedNFTs(uint256 _maxQuantity) internal {
        if (_maxQuantity == 0) {
            revert Launchpeg__InvalidQuantity();
        }
        if (amountMintedDuringPreMint == amountBatchMinted) {
            revert Launchpeg__MaxSupplyForBatchMintReached();
        }
        uint256 remQuantity = _maxQuantity;
        uint256 price = _preMintPrice();
        address sender;
        uint256 quantity;
        uint256 i = preMintQueueIdx;
        uint256 length = preMintQueue.length;
        while (i < length && remQuantity > 0) {
            PreMintData memory data = preMintQueue[i];
            sender = data.sender;
            if (data.quantity > remQuantity) {
                quantity = remQuantity;
                preMintQueue[i].quantity -= quantity;
            } else {
                quantity = data.quantity;
                delete preMintQueue[i];
                i++;
            }
            remQuantity -= quantity;
            userAddressToPreMintAmount[sender] -= quantity;
            _mint(sender, quantity, "", false);
            emit Mint(
                sender,
                quantity,
                price,
                _totalMinted() - quantity,
                Phase.PreMint
            );
        }
        amountBatchMinted += (_maxQuantity - remQuantity);
        preMintQueueIdx = i;
    }

    function _preMintPrice() internal view virtual returns (uint256);

    /// @notice Withdraw AVAX to the given recipient
    /// @param _to Recipient of the earned AVAX
    function withdrawAVAX(address _to)
        external
        override
        onlyOwnerOrRole(PROJECT_OWNER_ROLE)
        nonReentrant
        whenNotPaused
    {
        if (
            withdrawAVAXStartTime > block.timestamp ||
            withdrawAVAXStartTime == 0
        ) {
            revert Launchpeg__WithdrawAVAXNotAvailable();
        }

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
        if (address(batchReveal) == address(0)) {
            return string(abi.encodePacked(baseURI, _id.toString()));
        } else if (
            _id >= batchReveal.launchpegToLastTokenReveal(address(this))
        ) {
            return unrevealedURI;
        } else {
            return
                string(
                    abi.encodePacked(
                        baseURI,
                        batchReveal
                            .getShuffledTokenId(address(this), _id)
                            .toString()
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
        override(
            ERC721AUpgradeable,
            ERC2981Upgradeable,
            IERC165Upgradeable,
            SafePausableUpgradeable
        )
        returns (bool)
    {
        return
            _interfaceId == type(IBaseLaunchpeg).interfaceId ||
            ERC721AUpgradeable.supportsInterface(_interfaceId) ||
            ERC2981Upgradeable.supportsInterface(_interfaceId) ||
            ERC165Upgradeable.supportsInterface(_interfaceId) ||
            SafePausableUpgradeable.supportsInterface(_interfaceId) ||
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

    /// @notice Reveals the next batch if the reveal conditions are met
    function revealNextBatch() external override isEOA whenNotPaused {
        if (address(batchReveal) == address(0)) {
            revert Launchpeg__BatchRevealDisabled();
        }
        if (!batchReveal.revealNextBatch(address(this), totalSupply())) {
            revert Launchpeg__RevealNextBatchNotAvailable();
        }
    }

    /// @notice Tells you if a batch can be revealed
    /// @return bool Whether reveal can be triggered or not
    /// @return uint256 The number of the next batch that will be revealed
    function hasBatchToReveal() external view override returns (bool, uint256) {
        if (address(batchReveal) == address(0)) {
            return (false, 0);
        }
        return batchReveal.hasBatchToReveal(address(this), totalSupply());
    }

    // @dev Total supply including pre-mints
    function _totalSupplyWithPreMint() internal view returns (uint256) {
        return totalSupply() + amountMintedDuringPreMint - amountBatchMinted;
    }

    // @notice Number minted by user including pre-mints
    function numberMintedWithPreMint(address _owner)
        public
        view
        override
        returns (uint256)
    {
        return _numberMinted(_owner) + userAddressToPreMintAmount[_owner];
    }
}
