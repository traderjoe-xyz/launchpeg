import '@nomiclabs/hardhat-ethers'
import { task } from 'hardhat/config'
import { loadLaunchConfig } from './utils'

task('deploy-flat-launch-peg', 'Deploy FlatLaunchPeg contract')
  .addParam('configFilename')
  .setAction(async ({ configFilename }, hre) => {
    console.log('-- Deploying FlatLaunchPeg --')
    const ethers = hre.ethers

    const launchConfig = loadLaunchConfig(configFilename)
    console.log(launchConfig)

    const FlatLaunchPegFactory = await ethers.getContractFactory('FlatLaunchPeg')

    const flatLaunchPeg = await FlatLaunchPegFactory.deploy(
      launchConfig.name,
      launchConfig.symbol,
      launchConfig.projectOwner,
      launchConfig.royaltyReceiver,
      launchConfig.maxBatchSize,
      launchConfig.collectionSize,
      launchConfig.amountForDevs,
      launchConfig.batchRevealSize,
      launchConfig.salePrice,
      launchConfig.mintlistPrice
    )

    await flatLaunchPeg.deployTransaction.wait()

    if (launchConfig.joeFeePercent && launchConfig.joeFeeCollector) {
      console.log('-- Initializating Joe fee --')
      await flatLaunchPeg.initializeJoeFee(launchConfig.joeFeePercent, launchConfig.joeFeeCollector)
    }

    console.log(`-- Contract deployed at ${flatLaunchPeg.address} --`)
  })
