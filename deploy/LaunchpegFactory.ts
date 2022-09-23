import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction, DeployResult } from 'hardhat-deploy/types'

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, getChainId, run, ethers } = hre
  const { deploy, catchUnknownSigner } = deployments
  const chainId = await getChainId()

  const { deployer } = await getNamedAccounts()

  const launchpegAddress = (await deployments.get('Launchpeg')).address
  const flatLaunchpegAddress = (await deployments.get('FlatLaunchpeg')).address
  const batchRevealAddress = (await deployments.get('BatchReveal')).address

  let proxyOwner: string
  if (chainId === '4' || chainId === '43113') {
    proxyOwner = '0xdB40a7b71642FE24CC546bdF4749Aa3c0B042f78'
  } else if (chainId === '43114' || chainId === '31337') {
    proxyOwner = '0x64c4607AD853999EE5042Ba8377BfC4099C273DE'
  }

  const constructorArgs: any[] = []
  const initArgs = [launchpegAddress, flatLaunchpegAddress, batchRevealAddress, 500, deployer]
  let proxyContract: DeployResult | undefined
  await catchUnknownSigner(async () => {
    proxyContract = await deploy('LaunchpegFactory', {
      from: deployer,
      args: constructorArgs,
      proxy: {
        owner: proxyOwner,
        proxyContract: 'OpenZeppelinTransparentProxy',
        viaAdminContract: 'DefaultProxyAdmin',
        execute: {
          init: {
            methodName: 'initialize',
            args: initArgs,
          },
        },
      },
      log: true,
    })
  })

  if (proxyContract && proxyContract.newlyDeployed && proxyContract.implementation) {
    // Initialize implementation contract
    const implementationContract = await ethers.getContractAt('LaunchpegFactory', proxyContract.implementation)
    await implementationContract.initialize(...initArgs)
  }

  if (proxyContract && proxyContract.implementation) {
    try {
      await run('verify:verify', {
        address: proxyContract.implementation,
        constructorArguments: constructorArgs,
      })
    } catch {}
  }
}
export default func
func.tags = ['LaunchpegFactory']
func.dependencies = ['Launchpeg', 'FlatLaunchpeg', 'BatchReveal']
