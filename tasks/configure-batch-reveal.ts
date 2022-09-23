import '@nomiclabs/hardhat-ethers'
import 'hardhat-deploy'
import 'hardhat-deploy-ethers'
import { task } from 'hardhat/config'
import { loadLaunchConfig } from './utils'

task('configure-batch-reveal', 'Configure batch reveal for a given launchpeg')
  .addParam('baseLaunchpeg')
  .addParam('configFilename')
  .setAction(async ({ baseLaunchpeg, configFilename }, hre) => {
    console.log('-- Configuring batch reveal --')

    const ethers = hre.ethers

    const batchRevealAddress = (await hre.deployments.get('BatchReveal')).address
    const batchReveal = await ethers.getContractAt('BatchReveal', batchRevealAddress)

    const config = loadLaunchConfig(configFilename)

    const tx = await batchReveal.configure(
      baseLaunchpeg,
      config.batchRevealSize,
      config.revealStartTime,
      config.revealInterval
    )

    await tx.wait()

    console.log(`-- Batch reveal configured --`)
  })
