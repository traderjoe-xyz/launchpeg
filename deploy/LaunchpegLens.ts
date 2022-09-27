import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, run } = hre
  const { deploy } = deployments

  const { deployer } = await getNamedAccounts()

  const launchpegFactoryAddress = (await deployments.get('LaunchpegFactory')).address
  const batchRevealAddress = (await deployments.get('BatchReveal')).address

  const constructorArgs = [launchpegFactoryAddress, batchRevealAddress]
  const result = await deploy('LaunchpegLens', {
    from: deployer,
    args: constructorArgs,
    log: true,
    autoMine: true, // speed up deployment on local network (ganache, hardhat), no effect on live networks
  })

  try {
    await run('verify:verify', {
      address: result.address,
      constructorArguments: constructorArgs,
    })
  } catch (err) {
    console.error(err)
  }
}
export default func
func.tags = ['LaunchpegLens']
func.dependencies = ['LaunchpegFactory', 'BatchReveal']
