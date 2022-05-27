import '@nomiclabs/hardhat-ethers'
import { task } from 'hardhat/config'

task('set-uris', 'Configure the unrevealed and base URI')
  .addParam('contractAddress')
  .addParam('unrevealedURI')
  .addParam('baseURI')
  .setAction(async ({ contractAddress, unrevealedURI, baseURI }, hre) => {
    const ethers = hre.ethers

    console.log('-- Configuring URIs --')
    const launchpeg = await ethers.getContractAt('Launchpeg', contractAddress)

    const unrevealedURItx = await launchpeg.setUnrevealedURI(unrevealedURI)
    await unrevealedURItx.wait()

    const baseURItx = await launchpeg.setBaseURI(baseURI)
    await baseURItx.wait()

    console.log('-- URIs configured --')
  })
