import '@nomiclabs/hardhat-ethers'
import 'hardhat-deploy'
import 'hardhat-deploy-ethers'
import { task } from 'hardhat/config'
import { loadLaunchConfig } from './utils'

task('deploy-batch-reveal', 'Deploy BatchReveal contract')
  .addParam('baseLaunchpeg')
  .addParam('configFilename')
  .setAction(async ({ baseLaunchpeg, configFilename }, hre) => {
    console.log('-- Deploying BatchReveal --')

    const ethers = hre.ethers

    const factoryAddress = (await hre.deployments.get('LaunchpegFactory')).address
    const factory = await ethers.getContractAt('LaunchpegFactory', factoryAddress)

    const config = loadLaunchConfig(configFilename)

    const creationTx = await factory.createBatchReveal(
      baseLaunchpeg,
      config.batchRevealSize,
      config.revealStartTime,
      config.revealInterval
    )

    await creationTx.wait()

    const batchReveal = creationTx.contract
    console.log(`-- Contract deployed at ${batchReveal.address} --`)

    if (config.keyHash && config.subscriptionId && config.maxGasLimit) {
      await hre.run('set-VRF', {
        contractAddress: batchReveal.address,
        keyHash: config.keyHash,
        subscriptionId: config.subscriptionId,
        maxGasLimit: config.maxGasLimit,
      })
    }
  })
