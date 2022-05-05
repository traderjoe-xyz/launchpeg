import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy } = deployments

  const { deployer } = await getNamedAccounts()

  const launchpegFactoryAddress = (await deployments.get('LaunchpegFactory')).address

  await deploy('LaunchpegLens', {
    from: deployer,
    args: [launchpegFactoryAddress],
    log: true,
    autoMine: true, // speed up deployment on local network (ganache, hardhat), no effect on live networks
  })
}
export default func
func.tags = ['LaunchpegLens']
func.dependencies = ['LaunchpegFactory']
