import '@nomiclabs/hardhat-ethers'
import 'hardhat-deploy'
import 'hardhat-deploy-ethers'
import { task } from 'hardhat/config'
import { loadLaunchConfig } from './utils'

task('deploy-launchpeg', 'Deploy Launchpeg contract')
  .addParam('configFilename')
  .setAction(async ({ configFilename }, hre) => {
    console.log('-- Deploying Launchpeg --')

    const ethers = hre.ethers
    const factoryAddress = (await hre.deployments.get('LaunchpegFactory')).address
    console.log(factoryAddress)

    const factory = await ethers.getContractAt('LaunchpegFactory', factoryAddress)

    const launchConfig = loadLaunchConfig(configFilename)

    const creationTx = await factory.createLaunchpeg(
      launchConfig.name,
      launchConfig.symbol,
      launchConfig.projectOwner,
      launchConfig.royaltyReceiver,
      launchConfig.maxBatchSize,
      launchConfig.collectionSize,
      launchConfig.amountForAuction,
      launchConfig.amountForMintlist,
      launchConfig.amountForDevs,
      [launchConfig.batchRevealSize, launchConfig.batchRevealStart, launchConfig.batchRevealInterval]
    )

    await creationTx.wait()

    const launchpegNumber = await factory.numLaunchpegs(0)
    const launchpegAddress = await factory.allLaunchpegs(0, launchpegNumber - 1)

    console.log(`-- Contract deployed at ${launchpegAddress} --`)

    console.log('-- Initializating phases --')

    const launchpeg = await ethers.getContractAt('Launchpeg', launchpegAddress)

    const initTx = await launchpeg.initializePhases(
      launchConfig.auctionSaleStartTime,
      launchConfig.auctionStartPrice,
      launchConfig.auctionEndPrice,
      launchConfig.auctionDropInterval,
      launchConfig.mintlistStartTime,
      launchConfig.mintlistDiscountPercent,
      launchConfig.publicSaleStartTime,
      launchConfig.publicSaleDiscountPercent
    )

    await initTx.wait()
  })
