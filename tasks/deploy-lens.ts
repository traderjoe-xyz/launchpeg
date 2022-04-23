import '@nomiclabs/hardhat-ethers'
import { task } from 'hardhat/config'

task('deploy-lens', 'Deploy LaunchPegLens contract').setAction(async ({}, hre) => {
  console.log('-- Deploying LaunchPegLens --')
  const ethers = hre.ethers

  const LaunchPegLensFactory = await ethers.getContractFactory('LaunchPegLens')

  const launchPegLens = await LaunchPegLensFactory.deploy()

  await launchPegLens.deployTransaction.wait()

  console.log(`-- Contract deployed at ${launchPegLens.address} --`)
})
