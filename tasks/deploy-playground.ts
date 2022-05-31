import '@nomiclabs/hardhat-ethers'
import 'hardhat-deploy'
import 'hardhat-deploy-ethers'
import { task } from 'hardhat/config'

task('deploy-playground', 'Deploy differents launchpeg contracts for testing').setAction(async ({}, hre) => {
  console.log('-- Deploying all contracts --')

  // Launchpegs
  await hre.run('deploy-launchpeg', { configFilename: 'playground-deployments/launchpeg-not-started.json' })
  await hre.run('deploy-launchpeg', { configFilename: 'playground-deployments/launchpeg-auction.json' })
  await hre.run('deploy-launchpeg', { configFilename: 'playground-deployments/launchpeg-allowlist.json' })
  await hre.run('deploy-launchpeg', { configFilename: 'playground-deployments/launchpeg-public.json' })
  await hre.run('deploy-launchpeg', { configFilename: 'playground-deployments/launchpeg-sold-out.json' })

  // FlatLaunchpegs
  await hre.run('deploy-flatlaunchpeg', { configFilename: 'playground-deployments/flatlaunchpeg-not-started.json' })
  await hre.run('deploy-flatlaunchpeg', { configFilename: 'playground-deployments/flatlaunchpeg-allowlist.json' })
  await hre.run('deploy-flatlaunchpeg', { configFilename: 'playground-deployments/flatlaunchpeg-public.json' })
  await hre.run('deploy-flatlaunchpeg', { configFilename: 'playground-deployments/flatlaunchpeg-sold-out.json' })
})
