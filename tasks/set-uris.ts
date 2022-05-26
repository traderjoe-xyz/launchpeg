import '@nomiclabs/hardhat-ethers'
import { task } from 'hardhat/config'

task('set-uris', 'Configure the unrevealed and base URI')
  .addParam('contractaddress')
  .addParam('unrevealeduri')
  .addParam('baseuri')
  .setAction(async ({ contractaddress, unrevealeduri, baseuri }, hre) => {
    const ethers = hre.ethers

    console.log('-- Configuring URIs --')
    const launchpeg = await ethers.getContractAt('Launchpeg', contractaddress)

    const unrevealedURItx = await launchpeg.setUnrevealedURI(unrevealeduri)
    await unrevealedURItx.wait()

    const baseURItx = await launchpeg.setBaseURI(baseuri)
    await baseURItx.wait()

    console.log('-- URIs configured --')
  })
