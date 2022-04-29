import '@nomiclabs/hardhat-ethers'
import { task } from 'hardhat/config'
import { loadLaunchConfig } from './utils'

task('deploy-flat-launch-peg', 'Deploy FlatLaunchpeg contract')
  .addParam('configFilename')
  .setAction(async ({ configFilename }, hre) => {
    console.log('-- Deploying FlatLaunchpeg --')
    const ethers = hre.ethers

    const launchConfig = loadLaunchConfig(configFilename)
    console.log(launchConfig)

    const FlatLaunchpegFactory = await ethers.getContractFactory('FlatLaunchpeg')

    const flatLaunchpeg = await FlatLaunchpegFactory.deploy(
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

    await flatLaunchpeg.deployTransaction.wait()

    if (launchConfig.joeFeePercent && launchConfig.joeFeeCollector) {
      console.log('-- Initializating Joe fee --')
      await flatLaunchpeg.initializeJoeFee(launchConfig.joeFeePercent, launchConfig.joeFeeCollector)
    }

    console.log(`-- Contract deployed at ${flatLaunchpeg.address} --`)
  })
