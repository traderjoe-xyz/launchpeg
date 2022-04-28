import '@nomiclabs/hardhat-ethers'
import { task } from 'hardhat/config'

task('deploy-lens', 'Deploy LaunchpegLens contract').setAction(async ({}, hre) => {
  console.log('-- Deploying LaunchpegLens --')
  const ethers = hre.ethers

  const LaunchpegLensFactory = await ethers.getContractFactory('LaunchpegLens')

  const launchpegLens = await LaunchpegLensFactory.deploy()

  await launchpegLens.deployTransaction.wait()

  console.log(`-- Contract deployed at ${launchpegLens.address} --`)
})
