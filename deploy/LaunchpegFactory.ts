import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy } = deployments

  const { deployer } = await getNamedAccounts()

  const launchpegAddress = (await deployments.get('Launchpeg')).address
  const flatLaunchpegAddress = (await deployments.get('FlatLaunchpeg')).address
  const batchRevealAddress = (await deployments.get('BatchReveal')).address

  await deploy('LaunchpegFactory', {
    from: deployer,
    proxy: {
      proxyContract: 'OpenZeppelinTransparentProxy',
      execute: {
        init: {
          methodName: 'initialize',
          args: [launchpegAddress, flatLaunchpegAddress, batchRevealAddress, 500, deployer],
        },
      },
    },
    log: true,
  })
}
export default func
func.tags = ['LaunchpegFactory']
func.dependencies = ['Launchpeg', 'FlatLaunchpeg']
