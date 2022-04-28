import '@nomiclabs/hardhat-ethers'
import { task } from 'hardhat/config'
import { loadLaunchConfig } from './utils'

task('verify-launch-peg', 'Verify Launchpeg contract')
  .addParam('contractAddress')
  .addParam('configFilename')
  .setAction(async ({ contractAddress, configFilename }, hre) => {
    const launchConfig = loadLaunchConfig(configFilename)
    await hre.run('verify:verify', {
      address: contractAddress,
      constructorArguments: [
        launchConfig.name,
        launchConfig.symbol,
        launchConfig.projectOwner,
        launchConfig.royaltyReceiver,
        launchConfig.maxBatchSize,
        launchConfig.collectionSize,
        launchConfig.amountForAuction,
        launchConfig.amountForMintlist,
        launchConfig.amountForDevs,
        launchConfig.batchRevealSize,
      ],
    })
  })
