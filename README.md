# LaunchPEG

This repository contains two [ERC721A](https://github.com/chiru-labs/ERC721A) implementations: 
- **LaunchPeg** implements a fair and gas efficient NFT launch mechanism in three phases : dutch auction, allowlist mint and public sale.
- **FlatLaunchPeg**  implements a simple minting NFT contract with an allowlist and public sale phase.

Both contracts implement [BatchReveal](https://github.com/tubby-cats/batch-nft-reveal) developed by Tubby Cats. This is an on-chain shuffling algorithm used to reveal NFTs in batches.

## How does it work ?

### Contracts

#### BaseLaunchPeg

An abstract contract inherited by both  `LaunchPeg` and `FlatLaunchPeg`. It contains common functionalities.

Each address is allowed to mint up to `maxPerAddressDuringMint` NFTs.

#### LaunchPeg
The sale takes place in three phases:

It starts with a dutch auction : the price gradually decreases over time until the end of the phase or when all tokens allocated are sold.

The allowlist mint starts right after the dutch auction : whitelisted users can buy NFTs at the last auction price eventually discounted by a percentage.

Once the allowlist mint ends, all remaining NFTs are sold in a public sale at the last auction price eventually discounted by a percentage.

#### FlatLaunchPeg

In this contract, the sale is simpler and takes place in two phases: an allowlist mint and public sale that can be enabled / disabled with `setPublicSaleActive`. 

### [](https://github.com/traderjoe-xyz/launchpeg/blob/45acb0516d2a0405ddf12a231ed422cfabc5f0e6/README.md#erc721a-from-azuki-)ERC721A from Azuki :

Implements a more efficient way of minting several NFTs. The number of NFTs minted at once is limited by  `maxBatchSize`.

You can find details about ERC721A here: https://www.erc721a.org/


### [](https://github.com/traderjoe-xyz/launchpeg/blob/45acb0516d2a0405ddf12a231ed422cfabc5f0e6/README.md#batch-reveal-from-tubby-cats-)Batch Reveal from Tubby Cats :

Allows to reveal NFT URIs  _pseudo-randomly for now_  and efficiently. Reveals are done by batch so people don't have to wait the end of the sale to see their NFTs. Reveal can be triggered by anyone under certain conditions, reducing the risk of randomness manipulation.

Reveal can be implemented in two ways :

-   Enough NFTs have been minted (we don’t want to reveal unsold NFTs)
-   Reveal start date has passed

"Revealing" a batch means that a random number will be drawn. This will be the offset that will link the token Id and the URI Id. All the logic afterwards is handled in the  `tokenURI()`  view function.

#### [](https://github.com/traderjoe-xyz/launchpeg/blob/45acb0516d2a0405ddf12a231ed422cfabc5f0e6/README.md#configuration-)Configuration :

`batchRevealSize`  : Number of NFTs that will be revealed at once

`revealStartTime`  : Date of the start of the NFT reveal

`revealInterval`  : Time interval between two reveals

#### [](https://github.com/traderjoe-xyz/launchpeg/blob/45acb0516d2a0405ddf12a231ed422cfabc5f0e6/README.md#scenarios-)Scenarios :

💡  `revealStartTime`  = 0 and  `revealInterval`  = 0

Users can trigger a reveal as soon as enough NFTs are minted, ie  `batchRevealSize`  is reached. Anyone can call the function at any time so it reduce the risk of randomness manipulation even without Chainlink VRF.

💡  `revealStartTime`  = D+3 and  `revealInterval`  = 30mins

Users can trigger a reveal 3 days after the sale begins. They will be able to reveal one batch every 30mins, assuming NFTs have been sold.

💡  Collection doesn’t sell out

If the collection doesn’t sell out people will be left with unrevealed NFTs. Project Owner can unlock the situation by forcing the reveal. Unsold NFTs from the same batch will be revealed as well.

## Setup

We use Hardhat to develop, compile, test and deploy contracts.
```
# install dependencies
yarn
```

## [](https://github.com/traderjoe-xyz/launchpeg/blob/45acb0516d2a0405ddf12a231ed422cfabc5f0e6/README.md#tests-and-test-coverage)Testing

```
yarn test # run test
yarn coverage # run coverage report from solidity-coverage
```

## [](https://github.com/traderjoe-xyz/launchpeg/blob/45acb0516d2a0405ddf12a231ed422cfabc5f0e6/README.md#deploy-contracts)Deploy contracts

There are two environment variables to define in the `.env` file:
```
# The contract deployer
DEPLOY_PRIVATE_KEY=
# The snowtrace API key used to verify contracts
SNOWTRACE_API_KEY=
```

The deploy task takes a config file as parameter. This file contains all the required parameters to initialize a contract.

There are two templates available in `/tasks/config`: `example.json` for `LaunchPeg` and `flat-example.json` for `FlatLaunchPeg`.

Once the configuration is ready, you may run:
```
yarn compile

yarn deploy-launchpeg-fuji --config-filename <config-filename>
yarn verify-launchpeg-fuji --contract-address <contract-address> --config-filename <config-filename>

yarn deploy-flat-launchpeg-fuji --config-filename <config-filename>
yarn verify-flat-launchpeg-fuji --contract-address <contract-address> --config-filename <config-filename>

yarn deploy-lens-fuji 
yarn verify-lens-fuji --contract-address <contract-address>
```