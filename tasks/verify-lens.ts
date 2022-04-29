import '@nomiclabs/hardhat-ethers'
import { task } from 'hardhat/config'

task('verify-lens', 'Verify LaunchpegLens contract')
  .addParam('contractAddress')
  .setAction(async ({ contractAddress }, hre) => {
    await hre.run('verify:verify', {
      address: contractAddress,
    })
  })
