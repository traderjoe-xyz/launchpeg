import '@nomiclabs/hardhat-ethers'
import { task } from 'hardhat/config'
import fs from 'fs'
import path from 'path'

task('deploy-launch-peg', 'Deploy LaunchPeg contract')
  .addParam('configFilename')
  .setAction(async ({ configFilename }, hre) => {
    console.log('-- Deploying LaunchPeg --')
    const ethers = hre.ethers

    const file = path.join(__dirname, `config/${configFilename}`)
    const launchConfig = JSON.parse(fs.readFileSync(file, 'utf8'))
    console.log(launchConfig)

    const LaunchPegFactory = await ethers.getContractFactory('LaunchPeg')

    const launchPeg = await LaunchPegFactory.deploy(
      launchConfig.name,
      launchConfig.symbol,
      launchConfig.projectOwner,
      launchConfig.maxBatchSize,
      launchConfig.collectionSize,
      launchConfig.amountForAuction,
      launchConfig.amountForMintlist,
      launchConfig.amountForDevs,
      launchConfig.batchRevealSize
    )

    await launchPeg.deployTransaction.wait()

    console.log('-- Initializating phases --')

    await launchPeg.initializePhases(
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

    if (launchConfig.joeFeePercent && launchConfig.joeFeeCollector) {
      console.log('-- Initializating Joe fee --')
      await launchPeg.initializeJoeFee(launchConfig.joeFeePercent, launchConfig.joeFeeCollector)
    }

    console.log(`-- Contract deployed at ${launchPeg.address} --`)
  })
