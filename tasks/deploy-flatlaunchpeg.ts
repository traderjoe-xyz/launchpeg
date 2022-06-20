import '@nomiclabs/hardhat-ethers'
import 'hardhat-deploy'
import 'hardhat-deploy-ethers'
import { task } from 'hardhat/config'
import { loadLaunchConfig } from './utils'

task('deploy-flatlaunchpeg', 'Deploy FlatLaunchpeg contract')
  .addParam('configFilename')
  .setAction(async ({ configFilename }, hre) => {
    console.log('-- Deploying FlatLaunchpeg --')

    const ethers = hre.ethers

    const factoryAddress = (await hre.deployments.get('LaunchpegFactory')).address
    const factory = await ethers.getContractAt('LaunchpegFactory', factoryAddress)

    const launchConfig = loadLaunchConfig(configFilename)

    const creationTx = await factory.createFlatLaunchpeg(
      launchConfig.name,
      launchConfig.symbol,
      launchConfig.projectOwner,
      launchConfig.royaltyReceiver,
      launchConfig.maxBatchSize,
      launchConfig.collectionSize,
      launchConfig.amountForDevs,
      launchConfig.amountForAllowlist,
      [launchConfig.batchRevealSize, launchConfig.batchRevealStart, launchConfig.batchRevealInterval]
    )

    await creationTx.wait()

    const launchpegNumber = await factory.numLaunchpegs(1)
    const launchpegAddress = await factory.allLaunchpegs(1, launchpegNumber - 1)

    console.log(`-- Contract deployed at ${launchpegAddress} --`)

    console.log('-- Initializating phases --')

    const launchpeg = await ethers.getContractAt('FlatLaunchpeg', launchpegAddress)

    const initTx = await launchpeg.initializePhases(
      launchConfig.allowlistStartTime,
      launchConfig.publicSaleStartTime,
      launchConfig.allowlistPrice,
      launchConfig.salePrice
    )

    await initTx.wait()

    console.log('-- Phases initialized --')

    if (launchConfig.allowlistLocalPath) {
      await hre.run('configure-allowlist', {
        csvPath: launchConfig.allowlistLocalPath,
        contractAddress: launchpeg.address,
      })
    }

    if (launchConfig.unrevealedURI && launchConfig.baseURI) {
      await hre.run('set-uris', {
        contractAddress: launchpeg.address,
        unrevealedURI: launchConfig.unrevealedURI,
        baseURI: launchConfig.baseURI,
      })
    }

    if (launchConfig.keyHash && launchConfig.subscriptionId && launchConfig.maxGasLimit) {
      await hre.run('set-VRF', {
        contractAddress: launchpeg.address,
        keyHash: launchConfig.keyHash,
        subscriptionId: launchConfig.subscriptionId,
        maxGasLimit: launchConfig.maxGasLimit,
      })
    }
  })
