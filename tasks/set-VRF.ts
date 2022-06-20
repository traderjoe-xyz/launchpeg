import '@nomiclabs/hardhat-ethers'
import { task } from 'hardhat/config'

const CONTROLLER = new Map()
CONTROLLER.set('43113', '0x2eD832Ba664535e5886b75D64C46EB9a228C2610')
CONTROLLER.set('43114', '0xd5D517aBE5cF79B7e95eC98dB0f0277788aFF634')

task('set-VRF', 'Turns VRF on')
  .addParam('contractAddress')
  .addParam('keyHash')
  .addParam('subscriptionId')
  .addParam('maxGasLimit')
  .setAction(async ({ contractAddress, keyHash, subscriptionId, maxGasLimit }, hre) => {
    const ethers = hre.ethers
    const chainId = await hre.getChainId()

    console.log('-- Adding Launchpeg as consumer --')

    const controller = await ethers.getContractAt('VRFCoordinatorV2Mock', CONTROLLER.get(chainId))

    const tx1 = await controller.addConsumer(subscriptionId, contractAddress)
    await tx1.wait()

    console.log('-- Calling setVRF --')
    const launchpeg = await ethers.getContractAt('Launchpeg', contractAddress)

    const tx2 = await launchpeg.setVRF(CONTROLLER.get(chainId), keyHash, subscriptionId, maxGasLimit)
    await tx2.wait()

    console.log('-- VRF configured --')
  })
