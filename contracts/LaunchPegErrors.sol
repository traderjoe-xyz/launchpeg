// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

error LaunchPeg__AuctionAlreadyInitialized();
error LaunchPeg__CanNotMintThisMany();
error LaunchPeg__CanOnlyMintMultipleOfMaxBatchSize();
error LaunchPeg__EndPriceGreaterThanStartPrice();
error LaunchPeg__InvalidAuctionStartTime();
error LaunchPeg__LargerCollectionSizeNeeded();
error LaunchPeg__MaxSupplyReached();
error LaunchPeg__MintlistBeforeAuction();
error LaunchPeg__NotEligibleForAllowlistMint();
error LaunchPeg__NotEnoughAVAX(uint256 avaxSent);
error LaunchPeg__PublicSaleBeforeMintlist();
error LaunchPeg__TransferFailed();
error LaunchPeg__TooManyAlreadyMintedBeforeDevMint();
error LaunchPeg__Unauthorized();
error LaunchPeg__WrongAddressesAndNumSlotsLength();
error LaunchPeg__WrongPhase();
