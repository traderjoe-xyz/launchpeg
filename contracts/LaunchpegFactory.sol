// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";

import "./interfaces/ILaunchpegFactory.sol";
import "./interfaces/ILaunchpeg.sol";
import "./interfaces/IFlatLaunchpeg.sol";
import "./LaunchpegErrors.sol";

/// @title Launchpeg Factory
/// @author Trader Joe
/// @notice Factory that creates Launchpeg contracts
contract LaunchpegFactory is
    ILaunchpegFactory,
    Initializable,
    OwnableUpgradeable
{
    /// @notice Launchpeg contract to be cloned
    address public override launchpegImplementation;
    /// @notice FlatLaunchpeg contract to be cloned
    address public override flatLaunchpegImplementation;

    /// @notice Default fee percentage
    uint256 public override joeFeePercent;
    /// @notice Default fee collector
    address public override joeFeeCollector;

    /// @notice Checks if an address is stored as a Launchpeg
    mapping(address => bool) public override isLaunchpeg;
    /// @notice Launchpegs address list
    address[] public override allLaunchpegs;

    /// @notice Initializes the Launchpeg factory
    /// @dev Uses clone factory pattern to save space
    /// @param _launchpegImplementation Launchpeg contract to be cloned
    /// @param _flatLaunchpegImplementation FlatLaunchpeg contract to be cloned
    /// @param _joeFeePercent Default fee percentage
    /// @param _joeFeeCollector Default fee collector
    function initialize(
        address _launchpegImplementation,
        address _flatLaunchpegImplementation,
        uint256 _joeFeePercent,
        address _joeFeeCollector
    ) public initializer {
        __Ownable_init();

        if (_launchpegImplementation == address(0)) {
            revert LaunchpegFactory__InvalidImplementation();
        }
        if (_flatLaunchpegImplementation == address(0)) {
            revert LaunchpegFactory__InvalidImplementation();
        }
        if (_joeFeePercent > 10_000) {
            revert Launchpeg__InvalidPercent();
        }
        if (_joeFeeCollector == address(0)) {
            revert Launchpeg__InvalidJoeFeeCollector();
        }

        launchpegImplementation = _launchpegImplementation;
        flatLaunchpegImplementation = _flatLaunchpegImplementation;
        joeFeePercent = _joeFeePercent;
        joeFeeCollector = _joeFeeCollector;
    }

    /// @notice Returns the number of Launchpegs
    /// @return LaunchpegNumber The number of Launchpegs ever created
    function numLaunchpegs() external view override returns (uint256) {
        return allLaunchpegs.length;
    }

    /// @notice Launchpeg creation
    /// @param _name ERC721 name
    /// @param _symbol ERC721 symbol
    /// @param _projectOwner The project owner
    /// @param _royaltyReceiver Royalty fee collector
    /// @param _maxBatchSize Max amount of NFTs that can be minted at once
    /// @param _collectionSize The collection size (e.g 10000)
    /// @param _amountForAuction Amount of NFTs available for the auction (e.g 8000)
    /// @param _amountForMintlist Amount of NFTs available for the allowList mint (e.g 1000)
    /// @param _amountForDevs Amount of NFTs reserved for `projectOwner` (e.g 200)
    /// @param _batchRevealSize Size of the batch reveal
    /// @return launchpeg New Launchpeg address
    function createLaunchpeg(
        string memory _name,
        string memory _symbol,
        address _projectOwner,
        address _royaltyReceiver,
        uint256 _maxBatchSize,
        uint256 _collectionSize,
        uint256 _amountForAuction,
        uint256 _amountForMintlist,
        uint256 _amountForDevs,
        uint256 _batchRevealSize
    ) external override onlyOwner returns (address) {
        address launchpeg = Clones.clone(launchpegImplementation);

        isLaunchpeg[launchpeg] = true;
        allLaunchpegs.push(launchpeg);

        ILaunchpeg(launchpeg).initialize(
            _name,
            _symbol,
            _projectOwner,
            _royaltyReceiver,
            _maxBatchSize,
            _collectionSize,
            _amountForAuction,
            _amountForMintlist,
            _amountForDevs,
            _batchRevealSize
        );

        IBaseLaunchpeg(launchpeg).initializeJoeFee(
            joeFeePercent,
            joeFeeCollector
        );

        OwnableUpgradeable(launchpeg).transferOwnership(msg.sender);

        emit LaunchpegCreated(
            launchpeg,
            _name,
            _symbol,
            _projectOwner,
            _royaltyReceiver,
            _maxBatchSize,
            _collectionSize,
            _amountForAuction,
            _amountForMintlist,
            _amountForDevs,
            _batchRevealSize
        );

        return launchpeg;
    }

    /// @notice FlatLaunchpeg creation
    /// @param _name ERC721 name
    /// @param _symbol ERC721 symbol
    /// @param _projectOwner The project owner
    /// @param _royaltyReceiver Royalty fee collector
    /// @param _maxBatchSize Max amount of NFTs that can be minted at once
    /// @param _collectionSize The collection size (e.g 10000)
    /// @param _amountForDevs Amount of NFTs reserved for `projectOwner` (e.g 200)
    /// @param _batchRevealSize Size of the batch reveal
    /// @param _salePrice Price of the public sale in Avax
    /// @param _mintlistPrice Price of the whitelist sale in Avax
    /// @return flatLaunchpeg New FlatLaunchpeg address
    function createFlatLaunchpeg(
        string memory _name,
        string memory _symbol,
        address _projectOwner,
        address _royaltyReceiver,
        uint256 _maxBatchSize,
        uint256 _collectionSize,
        uint256 _amountForDevs,
        uint256 _batchRevealSize,
        uint256 _salePrice,
        uint256 _mintlistPrice
    ) external override onlyOwner returns (address) {
        address flatLaunchpeg = Clones.clone(flatLaunchpegImplementation);

        isLaunchpeg[flatLaunchpeg] = true;
        allLaunchpegs.push(flatLaunchpeg);

        IFlatLaunchpeg(flatLaunchpeg).initialize(
            _name,
            _symbol,
            _projectOwner,
            _royaltyReceiver,
            _maxBatchSize,
            _collectionSize,
            _amountForDevs,
            _batchRevealSize,
            _salePrice,
            _mintlistPrice
        );

        IBaseLaunchpeg(flatLaunchpeg).initializeJoeFee(
            joeFeePercent,
            joeFeeCollector
        );

        OwnableUpgradeable(flatLaunchpeg).transferOwnership(msg.sender);

        emit FlatLaunchpegCreated(
            flatLaunchpeg,
            _name,
            _symbol,
            _projectOwner,
            _royaltyReceiver,
            _maxBatchSize,
            _collectionSize,
            _amountForDevs,
            _batchRevealSize,
            _salePrice,
            _mintlistPrice
        );

        return flatLaunchpeg;
    }

    /// @notice Set address for launchpegImplementation
    /// @param _launchpegImplementation New launchpegImplementation
    function setLaunchpegImplementation(address _launchpegImplementation)
        external
        override
        onlyOwner
    {
        if (_launchpegImplementation == address(0)) {
            revert LaunchpegFactory__InvalidImplementation();
        }

        launchpegImplementation = _launchpegImplementation;
        emit SetLaunchpegImplementation(_launchpegImplementation);
    }

    /// @notice Set address for flatLaunchpegImplementation
    /// @param _flatLaunchpegImplementation New flatLaunchpegImplementation
    function setFlatLaunchpegImplementation(
        address _flatLaunchpegImplementation
    ) external override onlyOwner {
        if (_flatLaunchpegImplementation == address(0)) {
            revert LaunchpegFactory__InvalidImplementation();
        }

        flatLaunchpegImplementation = _flatLaunchpegImplementation;
        emit SetFlatLaunchpegImplementation(_flatLaunchpegImplementation);
    }

    /// @notice Set percentage of protocol fees
    /// @param _joeFeePercent New joeFeePercent
    function setDefaultJoeFeePercent(uint256 _joeFeePercent)
        external
        override
        onlyOwner
    {
        if (_joeFeePercent > 10_000) {
            revert Launchpeg__InvalidPercent();
        }

        joeFeePercent = _joeFeePercent;
        emit SetDefaultJoeFeePercent(_joeFeePercent);
    }

    /// @notice Set default address to collect protocol fees
    /// @param _joeFeeCollector New collector address
    function setDefaultJoeFeeCollector(address _joeFeeCollector)
        external
        override
        onlyOwner
    {
        if (_joeFeeCollector == address(0)) {
            revert Launchpeg__InvalidJoeFeeCollector();
        }

        joeFeeCollector = _joeFeeCollector;
        emit SetDefaultJoeFeeCollector(_joeFeeCollector);
    }
}
