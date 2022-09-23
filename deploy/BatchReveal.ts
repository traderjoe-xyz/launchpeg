import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction, DeployResult } from 'hardhat-deploy/types'

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, getChainId, run, ethers } = hre
  const { deploy, catchUnknownSigner } = deployments

  const chainId = await getChainId()
  const { deployer } = await getNamedAccounts()

  let proxyOwner: string
  if (chainId === '4' || chainId === '43113') {
    proxyOwner = '0xdB40a7b71642FE24CC546bdF4749Aa3c0B042f78'
  } else if (chainId === '43114' || chainId === '31337') {
    proxyOwner = '0x64c4607AD853999EE5042Ba8377BfC4099C273DE'
  }

  let proxyContract: DeployResult | undefined
  await catchUnknownSigner(async () => {
    proxyContract = await deploy('BatchReveal', {
      from: deployer,
      proxy: {
        owner: proxyOwner,
        proxyContract: 'OpenZeppelinTransparentProxy',
        viaAdminContract: 'DefaultProxyAdmin',
        execute: {
          init: {
            methodName: 'initialize',
            args: [],
          },
        },
      },
      log: true,
    })
  })

  if (proxyContract && proxyContract.newlyDeployed && proxyContract.implementation) {
    // Initialize implementation contract
    const implementationContract = await ethers.getContractAt('BatchReveal', proxyContract.implementation)
    await implementationContract.initialize([])
  }

  if (proxyContract && proxyContract.implementation) {
    try {
      await run('verify:verify', {
        address: proxyContract.implementation,
        constructorArguments: [],
      })
    } catch {}
  }
}
export default func
func.tags = ['BatchReveal']
