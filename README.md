# Trader Joe Launchpegs

Two implementations of ERC721 NFT contracts with [ERC721A batch minting from Azuki](https://github.com/chiru-labs/ERC721A) and batch reveal from [Tubby-Cats](https://github.com/tubby-cats/batch-nft-reveal).

**FlatLaunchPeg** is a basic NFT sale with whitelist + public sale.

**LaunchPeg** implements a Dutch auction mecanism in three phases :
-   Dutch auction phase : Price is gradually decreased over time until the end of the phase or all tokens allocated are sold
-   Mintlist phase : Whitelisted users can buy NFTs at the last price from the dutch phase with an eventual discount
-   Public sale phase : All remaining NFTs are sold at the last price from the dutch phase with an eventual discount 

## ERC721A from Azuki :

Implements a more efficient way of minting several NFTs. The number of NFTs minted at once is limited by `maxBatchSize`.

## Batch Reveal from Tubby Cats :

Allows to reveal NFT URIs *pseudo-randomly for now* and efficiently. Reveals are done by batch so people don't have to wait the end of the sale to see their NFTs. Reveal can be trigerred by anyone under certain conditions, reducing the risk of randomness manipulation.

Reveal can be implemented in two ways :

- Enough NFTs have been minted (we don’t want to reveal unsold NFTs)
- Reveal start date has passed

"Revealing" a batch means that a random number will be drawn. This will be the offset that will link the token Id and the URI Id. All the logic afterwards is handled in the `tokenURI()` view function.

### Configuration :

`batchRevealSize` : Number of NFTs that will be revealed at once

`revealStartTime` : Date of the start of the NFT reveal

`revealInterval` : Time interval between two reveals

### Scenarios :

💡 `revealStartTime` = 0 and `revealInterval` = 0


Users can trigger a reveal  as soon as enough NFTs are minted, ie `batchRevealSize` is reached. Anyone can call the function at any time so it reduce the risk of randomness manipulation even without Chainlink VRF.

💡 `revealStartTime` = D+3 and `revealInterval` = 30mins


Users can trigger a reveal 3 days after the sale begins. They will be able to reveal one batch every 30mins, assuming NFTs have been sold.

💡 Collection doesn’t sell out

If the collection doesn’t sell out people will be left with unrevealed NFTs. Project Owner can unlock the situation by forcing the reveal. Unsold NFTs from the same batch will be revealed aswell.

## Tests and test coverage
```
yarn # install dependencies
yarn test # run test
yarn coverage # run coverage report from solidity-coverage
```

## Deploy contracts

Create a config file in ./tasks/config (see example.json), then run:

```
yarn compile
yarn deploy-launchpeg-fuji --config-filename <config-filename>
yarn verify-launchpeg-fuji --contract-address <contract-address> --config-filename <config-filename>
yarn deploy-flat-launchpeg-fuji --config-filename <config-filename>
yarn verify-flat-launchpeg-fuji --contract-address <contract-address> --config-filename <config-filename>
```