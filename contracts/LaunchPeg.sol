// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

import "erc721a/contracts/ERC721A.sol";
import "./BatchReveal.sol";

import "./interfaces/ILaunchPeg.sol";
import "./LaunchPegErrors.sol";


/// @title LaunchPeg
/// @author Trader Joe
/// @notice Implements a fair and gas efficient NFT launch mechanism. The sale takes place in 3 phases: dutch auction, allowlist mint, public sale.
contract LaunchPeg is
    Ownable,
    ERC721A,
    ReentrancyGuard,
    ILaunchPeg,
    BatchReveal
{
    using Strings for uint256;

    enum Phase {
        NotStarted,
        DutchAuction,
        Mintlist,
        PublicSale
    }

    /// @notice The collection size (e.g 10000)
    uint256 public immutable collectionSize;

    /// @notice Amount of NFTs reserved for `projectOwner` (e.g 200)
    /// @dev It can be minted any time via `devMint`
    uint256 public immutable amountForDevs;

    /// @notice Amount of NFTs available for the auction (e.g 8000)
    /// Unsold items are put up for sale during the public sale.
    uint256 public immutable amountForAuction;

    /// @notice Amount of NFTs available for the allowlist mint (e.g 1000)
    /// Unsold items are put up for sale during the public sale.
    uint256 public immutable amountForMintlist;

    /// @notice Max amount of NFTs an address can mint
    uint256 public immutable maxPerAddressDuringMint;

    /// @notice Max amout of NFTs that can be minted at once
    uint256 public immutable maxBatchSize;

    /// @dev Tracks the amount of NFTs minted by `projectOwner`
    uint256 private amountMintedByDevs;

    /// @dev Tracks the amount of NFTs minted during the dutch auction
    uint256 private amountMintedDuringAuction;

    /// @notice Start time of the dutch auction in seconds
    /// @dev Timestamp
    uint256 public auctionSaleStartTime;

    /// @notice Start time of the allowlist mint in seconds
    /// @dev A timestamp greater than the dutch auction start
    uint256 public mintlistStartTime;

    /// @notice Start time of the public sale in seconds
    /// @dev A timestamp greater than the allowlist mint start
    uint256 public publicSaleStartTime;

    /// @notice Auction start price in AVAX
    /// @dev auctionStartPrice is scaled to 1e18
    uint256 public auctionStartPrice;

    /// @notice Auction floor price in AVAX
    /// @dev auctionEndPrice is scaled to 1e18
    uint256 public auctionEndPrice;

    /// @notice Duration of the auction in seconds
    /// @dev auctionSaleStartTime - mintlistStartTime
    uint256 public auctionSaleDuration;

    /// @notice Time elapsed between each drop in price
    /// @dev in seconds
    uint256 public auctionDropInterval;

    /// @notice Amount in AVAX deducted at each interval
    uint256 public auctionDropPerStep;

    /// @notice The price of the last NFT sold during the auction
    /// @dev lastAuctionPrice is scaled to 1e18
    uint256 private lastAuctionPrice;

    /// @notice The discount applied to the last auction price during the allowlist mint
    /// @dev in basis points e.g 500 for 5%
    uint256 public mintlistDiscountPercent;

    /// @notice The discount applied to the last auction price during the public sale
    /// @dev in basis points e.g 2500 for 25%
    uint256 public publicSaleDiscountPercent;

    /// @notice The amount of NFTs each allowed address can mint during the allowlist mint
    mapping(address => uint256) public allowlist;

    /// @notice The fees collected by Joepeg on the sale benefits
    /// @dev in basis points e.g 100 for 1%
    uint256 public joeFeePercent;

    /// @notice The address to which the fees on the sale will be sent
    address public joeFeeCollector;

    /// @notice The project owner
    /// @dev We may own the contract during the launch: this address is allowed to call `devMint`
    address public projectOwner;

    /// @dev Base token URI
    string private _baseTokenURI;

    /// @dev Unrevealed token URI
    string private _unrevealedTokenURI;

    uint256 public revealStartTime;
    uint256 public revealInterval;

    modifier atPhase(Phase _phase) {
        if (currentPhase() != _phase) {
            revert LaunchPeg__WrongPhase();
        }
        _;
    }

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
        uint256 _maxBatchSize,
        uint256 _collectionSize,
        uint256 _amountForAuction,
        uint256 _amountForMintlist,
        uint256 _amountForDevs,
        uint256 _batchRevealSize
    ) ERC721A(_name, _symbol)
        BatchReveal(_batchRevealSize) {
        if (
            _amountForAuction + _amountForMintlist + _amountForDevs >
            _collectionSize
        ) {
            revert LaunchPeg__LargerCollectionSizeNeeded();
        }

        projectOwner = _projectOwner;
        collectionSize = _collectionSize;
        maxBatchSize = _maxBatchSize;
        maxPerAddressDuringMint = _maxBatchSize;
        amountForAuction = _amountForAuction;
        amountForMintlist = _amountForMintlist;
        amountForDevs = _amountForDevs;

        // BatchReveal initialisation
        TOKEN_LIMIT = _collectionSize;
        RANGE_LENGTH = (_collectionSize / _batchRevealSize) * 2;
        intTOKEN_LIMIT = int128(int256(_collectionSize));
    }

    /// @inheritdoc ILaunchPeg
    function initializePhases(
        uint256 _auctionSaleStartTime,
        uint256 _auctionStartPrice,
        uint256 _auctionEndPrice,
        uint256 _auctionDropInterval,
        uint256 _mintlistStartTime,
        uint256 _mintlistDiscountPercent,
        uint256 _publicSaleStartTime,
        uint256 _publicSaleDiscountPercent,
        uint256 _revealStartTime,
        uint256 _revealInterval
    ) external override atPhase(Phase.NotStarted) {
        if (auctionSaleStartTime != 0) {
            revert LaunchPeg__AuctionAlreadyInitialized();
        }
        if (_auctionSaleStartTime == 0) {
            revert LaunchPeg__InvalidAuctionStartTime();
        }
        if (_auctionStartPrice <= _auctionEndPrice) {
            revert LaunchPeg__EndPriceGreaterThanStartPrice();
        }
        if (_mintlistStartTime <= _auctionSaleStartTime) {
            revert LaunchPeg__MintlistBeforeAuction();
        }
        if (_publicSaleStartTime <= _mintlistStartTime) {
            revert LaunchPeg__PublicSaleBeforeMintlist();
        }
        if (
            _mintlistDiscountPercent > 10000 ||
            _publicSaleDiscountPercent > 10000
        ) {
            revert LaunchPeg__InvalidPercent();
        }

        auctionSaleStartTime = _auctionSaleStartTime;
        auctionStartPrice = _auctionStartPrice;
        lastAuctionPrice = _auctionStartPrice;
        auctionEndPrice = _auctionEndPrice;
        auctionSaleDuration = _mintlistStartTime - _auctionSaleStartTime;
        auctionDropInterval = _auctionDropInterval;
        auctionDropPerStep =
            (_auctionStartPrice - _auctionEndPrice) /
            (auctionSaleDuration / _auctionDropInterval);

        mintlistStartTime = _mintlistStartTime;
        mintlistDiscountPercent = _mintlistDiscountPercent;

        publicSaleStartTime = _publicSaleStartTime;
        publicSaleDiscountPercent = _publicSaleDiscountPercent;

        revealStartTime = _revealStartTime;
        revealInterval = _revealInterval;

        emit Initialized(
            name(),
            symbol(),
            projectOwner,
            maxBatchSize,
            collectionSize,
            amountForAuction,
            amountForMintlist,
            amountForDevs,
            auctionSaleStartTime,
            auctionStartPrice,
            auctionEndPrice,
            auctionDropInterval,
            mintlistStartTime,
            mintlistDiscountPercent,
            publicSaleStartTime,
            publicSaleDiscountPercent
        );
    }

    /// @inheritdoc ILaunchPeg
    function initializeJoeFee(uint256 _joeFeePercent, address _joeFeeCollector)
        external
        override
        onlyOwner
        atPhase(Phase.NotStarted)
    {
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

    /// @inheritdoc ILaunchPeg
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

    /// @inheritdoc ILaunchPeg
    function auctionMint(uint256 _quantity)
        external
        payable
        override
        isEOA
        atPhase(Phase.DutchAuction)
    {
        uint256 _remainingSupply = (amountForAuction + amountMintedByDevs) -
            totalSupply();
        if (_remainingSupply == 0) {
            revert LaunchPeg__MaxSupplyReached();
        }
        if (_remainingSupply < _quantity) {
            _quantity = _remainingSupply;
        }
        if (numberMinted(msg.sender) + _quantity > maxPerAddressDuringMint) {
            revert LaunchPeg__CanNotMintThisMany();
        }
        lastAuctionPrice = getAuctionPrice(auctionSaleStartTime);
        uint256 totalCost = lastAuctionPrice * _quantity;
        refundIfOver(totalCost);
        _safeMint(msg.sender, _quantity);
        amountMintedDuringAuction = amountMintedDuringAuction + _quantity;
        emit Mint(
            msg.sender,
            _quantity,
            lastAuctionPrice,
            _totalMinted() - _quantity,
            Phase.DutchAuction
        );
    }

    /// @inheritdoc ILaunchPeg
    function allowlistMint()
        external
        payable
        override
        isEOA
        atPhase(Phase.Mintlist)
    {
        if (allowlist[msg.sender] <= 0) {
            revert LaunchPeg__NotEligibleForAllowlistMint();
        }
        uint256 _remainingAuctionSupply = amountForAuction -
            amountMintedDuringAuction;
        if (
            totalSupply() + _remainingAuctionSupply + 1 >
            amountForAuction + amountForMintlist + amountMintedByDevs
        ) {
            revert LaunchPeg__MaxSupplyReached();
        }
        allowlist[msg.sender]--;
        uint256 price = getMintlistPrice();
        refundIfOver(price);
        _safeMint(msg.sender, 1);
        emit Mint(msg.sender, 1, price, _totalMinted() - 1, Phase.Mintlist);
    }

    /// @inheritdoc ILaunchPeg
    function getMintlistPrice() public view override returns (uint256) {
        return
            lastAuctionPrice -
            (lastAuctionPrice * mintlistDiscountPercent) /
            10000;
    }

    /// @inheritdoc ILaunchPeg
    function publicSaleMint(uint256 _quantity)
        external
        payable
        override
        isEOA
        atPhase(Phase.PublicSale)
    {
        if (
            totalSupply() + _quantity >
            collectionSize - (amountForDevs - amountMintedByDevs)
        ) {
            revert LaunchPeg__MaxSupplyReached();
        }
        if (numberMinted(msg.sender) + _quantity > maxPerAddressDuringMint) {
            revert LaunchPeg__CanNotMintThisMany();
        }
        uint256 price = getPublicSalePrice();
        refundIfOver(price * _quantity);
        _safeMint(msg.sender, _quantity);
        emit Mint(
            msg.sender,
            _quantity,
            price,
            _totalMinted() - _quantity,
            Phase.PublicSale
        );
    }

    /// @inheritdoc ILaunchPeg
    function getPublicSalePrice() public view override returns (uint256) {
        return
            lastAuctionPrice -
            (lastAuctionPrice * publicSaleDiscountPercent) /
            10000;
    }

    /// @dev Verifies that enough AVAX has been sent by the sender and refunds the extra tokens if any
    /// @param _price The price paid by the sender for minting NFTs
    function refundIfOver(uint256 _price) private {
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

    /// @inheritdoc ILaunchPeg
    function getAuctionPrice(uint256 _saleStartTime)
        public
        view
        override
        returns (uint256)
    {
        if (block.timestamp < _saleStartTime) {
            return auctionStartPrice;
        }
        if (block.timestamp - _saleStartTime >= auctionSaleDuration) {
            return auctionEndPrice;
        } else {
            uint256 steps = (block.timestamp - _saleStartTime) /
                auctionDropInterval;
            return auctionStartPrice - (steps * auctionDropPerStep);
        }
    }

    /// @inheritdoc ILaunchPeg
    function currentPhase() public view override returns (Phase) {
        if (
            auctionSaleStartTime == 0 ||
            mintlistStartTime == 0 ||
            publicSaleStartTime == 0 ||
            block.timestamp < auctionSaleStartTime
        ) {
            return Phase.NotStarted;
        } else if (
            block.timestamp >= auctionSaleStartTime &&
            block.timestamp < mintlistStartTime
        ) {
            return Phase.DutchAuction;
        } else if (
            block.timestamp >= mintlistStartTime &&
            block.timestamp < publicSaleStartTime
        ) {
            return Phase.Mintlist;
        }
        return Phase.PublicSale;
    }

    /// @inheritdoc ILaunchPeg
    function setProjectOwner(address _projectOwner)
        external
        override
        onlyOwner
    {
        projectOwner = _projectOwner;
        emit ProjectOwnerUpdated(projectOwner);
    }

    /// @inheritdoc ILaunchPeg
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

    /// @dev Returns the base token URI
    function _baseURI() internal view virtual override returns (string memory) {
        return _baseTokenURI;
    }

    /// @inheritdoc ILaunchPeg
    function setBaseURI(string calldata baseURI) external override onlyOwner {
        _baseTokenURI = baseURI;
    }

    /// @dev Returns the unrevealed token URI
    function _unrevealedURI() internal view virtual  returns (string memory) {
        return _unrevealedTokenURI;
    }

    /// @inheritdoc ILaunchPeg
    function setUnrevealedURI(string calldata unrevealedURI) external override onlyOwner {
        _unrevealedTokenURI = unrevealedURI;
    }

    /// @inheritdoc ILaunchPeg
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

    /// @inheritdoc ILaunchPeg
    function numberMinted(address owner)
        public
        view
        override
        returns (uint256)
    {
        return _numberMinted(owner);
    }

    /// @inheritdoc ILaunchPeg
    function getOwnershipData(uint256 tokenId)
        external
        view
        override
        returns (TokenOwnership memory)
    {
        return _ownershipOf(tokenId);
    }

    function tokenURI(uint256 id)
        public
        view
        override(ERC721A, IERC721Metadata)
        returns (string memory)
    {
        if (id >= lastTokenRevealed) {
            return _unrevealedURI();
        } else {
            return
                string(
                    abi.encodePacked(
                        _baseURI(),
                        getShuffledTokenId(id).toString()
                    )
                );
        }
    }

     function setBatchSeed() public {
        uint256 batchNumber;
        unchecked {
            batchNumber = lastTokenRevealed / revealBatchSize;
            lastTokenRevealed += revealBatchSize;
        }
         
        if (block.timestamp < revealStartTime + batchNumber * revealInterval) {
            revert LaunchPeg__SetBatchSeedNotAvailable();
        }

        uint256 randomness = uint256(
                    keccak256(
                        abi.encode(
                            msg.sender,
                            tx.gasprice,
                            block.number,
                            block.timestamp,
                            block.difficulty,
                            blockhash(block.number - 1),
                            address(this),
                            totalSupply()
                        )
                    )
                );

        // not perfectly random since the folding doesn't match bounds perfectly, but difference is small
        batchToSeed[batchNumber] =
            randomness %
            (TOKEN_LIMIT - (batchNumber * revealBatchSize));
    }
}
