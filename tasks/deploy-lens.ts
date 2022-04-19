import '@nomiclabs/hardhat-ethers'
import { task } from 'hardhat/config'

task('deploy-lens', 'Deploy LaunchPegLens contract').setAction(async ({}, hre) => {
  console.log('-- Deploying LaunchPegLens --')
  const ethers = hre.ethers

  const LaunchPegLensFactory = await ethers.getContractFactory('LaunchPegLens')

  const LaunchPegLens = await LaunchPegLensFactory.deploy()

  await LaunchPegLens.deployTransaction.wait()

  console.log(`-- Contract deployed at ${LaunchPegLens.address} --`)
})
