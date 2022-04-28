import '@nomiclabs/hardhat-ethers'
import { task } from 'hardhat/config'
import { loadLaunchConfig } from './utils'

task('deploy-launch-peg', 'Deploy Launchpeg contract')
  .addParam('configFilename')
  .setAction(async ({ configFilename }, hre) => {
    console.log('-- Deploying Launchpeg --')
    const ethers = hre.ethers

    const launchConfig = loadLaunchConfig(configFilename)
    console.log(launchConfig)

    const LaunchpegFactory = await ethers.getContractFactory('Launchpeg')

    const launchpeg = await LaunchpegFactory.deploy(
      launchConfig.name,
      launchConfig.symbol,
      launchConfig.projectOwner,
      launchConfig.royaltyReceiver,
      launchConfig.maxBatchSize,
      launchConfig.collectionSize,
      launchConfig.amountForAuction,
      launchConfig.amountForMintlist,
      launchConfig.amountForDevs,
      launchConfig.batchRevealSize
    )

    await launchpeg.deployTransaction.wait()

    console.log('-- Initializating phases --')

    const initTx = await launchpeg.initializePhases(
      launchConfig.auctionSaleStartTime,
      launchConfig.auctionStartPrice,
      launchConfig.auctionEndPrice,
      launchConfig.auctionDropInterval,
      launchConfig.mintlistStartTime,
      launchConfig.mintlistDiscountPercent,
      launchConfig.publicSaleStartTime,
      launchConfig.publicSaleDiscountPercent,
      launchConfig.revealStartTime,
      launchConfig.revealInterval
    )

    await initTx.wait()

    if (launchConfig.joeFeePercent && launchConfig.joeFeeCollector) {
      console.log('-- Initializating Joe fee --')
      await launchpeg.initializeJoeFee(launchConfig.joeFeePercent, launchConfig.joeFeeCollector)
    }

    console.log(`-- Contract deployed at ${launchpeg.address} --`)
  })
