import '@nomiclabs/hardhat-ethers'
import { task } from 'hardhat/config'

const CONTROLLER = new Map()
CONTROLLER.set('43113', '0x2eD832Ba664535e5886b75D64C46EB9a228C2610')
CONTROLLER.set('43114', '0xd5D517aBE5cF79B7e95eC98dB0f0277788aFF634')

task('set-VRF', 'Turns VRF on')
  .addParam('keyHash') // e.g 0x354d2f95da55398f44b7cff77da56283d9c6c829a4bdf1bbcaf2ad6a4d081f61
  .addParam('subscriptionId') // e.g 139
  .addParam('maxGasLimit') // e.g 200000
  .setAction(async ({ keyHash, subscriptionId, maxGasLimit }, hre) => {
    const ethers = hre.ethers
    const chainId = await hre.getChainId()

    const batchRevealAddress = (await hre.deployments.get('BatchReveal')).address
    const batchReveal = await ethers.getContractAt('BatchReveal', batchRevealAddress)

    console.log('-- Adding BatchReveal as consumer --')

    const controller = await ethers.getContractAt('VRFCoordinatorV2Mock', CONTROLLER.get(chainId))

    const addConsumerTx = await controller.addConsumer(subscriptionId, batchRevealAddress)
    await addConsumerTx.wait()

    console.log('-- Calling setVRF --')

    const setVRFTx = await batchReveal.setVRF(CONTROLLER.get(chainId), keyHash, subscriptionId, maxGasLimit)
    await setVRFTx.wait()

    console.log('-- VRF configured --')
  })
