// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

import "./LaunchPegErrors.sol";
import "./interfaces/IFlatLaunchPeg.sol";

contract FlatLaunchPeg is ERC721, Ownable, IFlatLaunchPeg {
    /// @notice The collection size (e.g 10000)
    uint256 public collectionSize;

    /// @dev last token minted
    uint256 private _lastTokenMinted;

    /// @notice Price of one NFT for people on the mint list
    /// @dev mintlistPrice is scaled to 1e18
    uint256 public immutable mintlistPrice;

    /// @notice The amount of NFTs each allowed address can mint during the allowlist mint
    mapping(address => uint256) public allowlist;

    /// @notice Price of one NFT during the public sale
    /// @dev salePrice is scaled to 1e18
    uint256 public immutable salePrice;

    /// @notice Determine wether or not users are allowed to buy from public sale
    bool public saleIsActive = false;

    /// @notice Max amout of NFTs that can be minted at once
    uint256 public immutable maxBatchSize;

    /// @dev Base token URI
    string private _baseTokenURI;

    /// @notice The project owner
    /// @dev We may own the contract during the launch: this address is allowed to call `devMint`
    address public projectOwner;

    /// @notice The fees collected by Joepeg on the sale benefits
    /// @dev in basis points e.g 100 for 1%
    uint256 public joeFeePercent;

    /// @notice The address to which the fees on the sale will be sent
    address public joeFeeCollector;

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
        uint256 _collectionSize,
        uint256 _maxBatchSize,
        uint256 _salePrice,
        uint256 _mintlistPrice
    ) ERC721(_name, _symbol) {
        projectOwner = _projectOwner;
        collectionSize = _collectionSize;
        maxBatchSize = _maxBatchSize;
        salePrice = _salePrice;
        mintlistPrice = _mintlistPrice;
    }

    /// @inheritdoc IFlatLaunchPeg
    function initializeJoeFee(uint256 _joeFeePercent, address _joeFeeCollector)
        external
        override
        onlyOwner
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

    /// @inheritdoc IFlatLaunchPeg
    function setProjectOwner(address _projectOwner)
        external
        override
        onlyOwner
    {
        projectOwner = _projectOwner;
        emit ProjectOwnerUpdated(projectOwner);
    }

    /// @inheritdoc IFlatLaunchPeg
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

    /// @inheritdoc IFlatLaunchPeg
    function totalSupply() external view override returns (uint256) {
        return _lastTokenMinted;
    }

    /// @inheritdoc IFlatLaunchPeg
    function setBaseURI(string memory baseURI) public override onlyOwner {
        _baseTokenURI = baseURI;
    }

    /// @inheritdoc IFlatLaunchPeg
    function flipSaleState() external override onlyOwner {
        saleIsActive = !saleIsActive;
    }

    /// @inheritdoc IFlatLaunchPeg
    function devMint(uint256 numberOfTokens)
        external
        override
        onlyProjectOwner
    {
        if (_lastTokenMinted + numberOfTokens > collectionSize) {
            revert LaunchPeg__MaxSupplyReached();
        }
        uint256 i;
        for (i = 0; i < numberOfTokens; i++) {
            _safeMint(msg.sender, _lastTokenMinted + i + 1);
        }
        _lastTokenMinted += numberOfTokens;
    }

    /// @inheritdoc IFlatLaunchPeg
    function allowlistMint() external payable override {
        if (allowlist[msg.sender] <= 0) {
            revert LaunchPeg__NotEligibleForAllowlistMint();
        }
        if (_lastTokenMinted + 1 > collectionSize) {
            revert LaunchPeg__MaxSupplyReached();
        }
        refundIfOver(mintlistPrice);

        allowlist[msg.sender]--;
        _safeMint(msg.sender, _lastTokenMinted + 1);
        _lastTokenMinted++;
    }

    /// @inheritdoc IFlatLaunchPeg
    function publicSaleMint(uint256 numberOfTokens) external payable override {
        if (!saleIsActive) {
            revert LaunchPeg__SaleClosed();
        }
        if (numberOfTokens > maxBatchSize) {
            revert LaunchPeg__CanNotMintThisMany();
        }

        if (_lastTokenMinted + numberOfTokens > collectionSize) {
            revert LaunchPeg__MaxSupplyReached();
        }
        refundIfOver(salePrice * numberOfTokens);

        for (uint256 i = 0; i < numberOfTokens; i++) {
            _safeMint(msg.sender, _lastTokenMinted + i + 1);
        }
        _lastTokenMinted += numberOfTokens;
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

    /// @inheritdoc IFlatLaunchPeg
    function withdrawMoney() external override onlyOwner {
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
}
