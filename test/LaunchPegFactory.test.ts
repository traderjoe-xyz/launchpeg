import { config as hardhatConfig, ethers, network, upgrades } from 'hardhat'
import { expect } from 'chai'
import { getDefaultLaunchpegConfig, LaunchpegConfig } from './utils/helpers'
import { ContractFactory, Contract } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

describe('LaunchpegFactory', () => {
  let launchpegCF: ContractFactory
  let flatLaunchpegCF: ContractFactory
  let launchpegFactoryCF: ContractFactory
  let launchpeg: Contract
  let flatLaunchpeg: Contract
  let launchpegFactory: Contract

  let config: LaunchpegConfig

  let signers: SignerWithAddress[]
  let dev: SignerWithAddress
  let alice: SignerWithAddress
  let bob: SignerWithAddress
  let projectOwner: SignerWithAddress
  let royaltyReceiver: SignerWithAddress

  before(async () => {
    launchpegCF = await ethers.getContractFactory('Launchpeg')
    flatLaunchpegCF = await ethers.getContractFactory('FlatLaunchpeg')
    launchpegFactoryCF = await ethers.getContractFactory('LaunchpegFactory')

    signers = await ethers.getSigners()
    dev = signers[0]
    alice = signers[1]
    bob = signers[2]
    projectOwner = signers[3]
    royaltyReceiver = signers[4]

    await network.provider.request({
      method: 'hardhat_reset',
      params: [
        {
          forking: {
            jsonRpcUrl: (hardhatConfig as any).networks.avalanche.url,
          },
          live: false,
          saveDeployments: true,
          tags: ['test', 'local'],
        },
      ],
    })

    config = { ...(await getDefaultLaunchpegConfig()) }
    await deployLaunchpeg()
    await deployFlatLaunchpeg()
  })

  const deployLaunchpeg = async () => {
    launchpeg = await launchpegCF.deploy()

    await launchpeg.initialize(
      'JoePEG',
      'JOEPEG',
      projectOwner.address,
      royaltyReceiver.address,
      config.maxBatchSize,
      config.collectionSize,
      config.amountForAuction,
      config.amountForMintlist,
      config.amountForDevs,
      config.batchRevealSize
    )
  }

  const deployFlatLaunchpeg = async () => {
    flatLaunchpeg = await flatLaunchpegCF.deploy()

    await flatLaunchpeg.initialize(
      'JoePEG',
      'JOEPEG',
      projectOwner.address,
      royaltyReceiver.address,
      config.maxBatchSize,
      config.collectionSize,
      config.amountForDevs,
      config.batchRevealSize,
      config.flatPublicSalePrice,
      config.flatMintListSalePrice
    )
  }

  const deployLaunchpegFactory = async () => {
    launchpegFactory = await upgrades.deployProxy(launchpegFactoryCF, [
      launchpeg.address,
      flatLaunchpeg.address,
      200,
      royaltyReceiver.address,
    ])
    await launchpegFactory.deployed()
  }

  beforeEach(async () => {
    await deployLaunchpegFactory()
  })

  describe('Launchpeg creation', () => {
    it('Should increment the number of Launchpegs', async () => {
      expect(await launchpegFactory.numLaunchpegs()).to.equal(0)

      await launchpegFactory.createLaunchpeg(
        'JoePEG',
        'JOEPEG',
        projectOwner.address,
        royaltyReceiver.address,
        config.maxBatchSize,
        config.collectionSize,
        config.amountForAuction,
        config.amountForMintlist,
        config.amountForDevs,
        config.batchRevealSize
      )

      expect(await launchpegFactory.numLaunchpegs()).to.equal(1)
    })

    it('Should create FlatLaunchpegs as well', async () => {
      expect(await launchpegFactory.numLaunchpegs()).to.equal(0)

      await launchpegFactory.createFlatLaunchpeg(
        'JoePEG',
        'JOEPEG',
        projectOwner.address,
        royaltyReceiver.address,
        config.maxBatchSize,
        config.collectionSize,
        config.amountForDevs,
        config.batchRevealSize,
        config.flatPublicSalePrice,
        config.flatMintListSalePrice
      )

      expect(await launchpegFactory.numLaunchpegs()).to.equal(1)
    })
  })

  describe('Factory configuration', () => {
    it('Should set the new Launchpeg implementation', async () => {
      const newAddress = '0x44c14d53D7B7672d7fD6E4A97fDA1A5f68F62aB6'
      await launchpegFactory.setLaunchpegImplementation(newAddress)
      expect(await launchpegFactory.launchpegImplementation()).to.equal(newAddress)
    })

    it('Should set the new FlatLaunchpeg implementation', async () => {
      const newAddress = '0x44c14d53D7B7672d7fD6E4A97fDA1A5f68F62aB6'
      await launchpegFactory.setFlatLaunchpegImplementation(newAddress)
      expect(await launchpegFactory.flatLaunchpegImplementation()).to.equal(newAddress)
    })

    it('Should set the new fee configuration', async () => {
      const newFees = 499
      await launchpegFactory.setDefaultJoeFeePercent(newFees)
      await launchpegFactory.setDefaultJoeFeeCollector(bob.address)

      await launchpegFactory.createLaunchpeg(
        'My new collection',
        'JOEPEG',
        projectOwner.address,
        royaltyReceiver.address,
        config.maxBatchSize,
        config.collectionSize,
        config.amountForAuction,
        config.amountForMintlist,
        config.amountForDevs,
        config.batchRevealSize
      )
      const launchpeg0Address = await launchpegFactory.allLaunchpegs(0)
      const launchpeg0 = await ethers.getContractAt('Launchpeg', launchpeg0Address)

      expect(await launchpeg0.joeFeePercent()).to.equal(newFees)
      expect(await launchpeg0.joeFeeCollector()).to.equal(bob.address)
    })
  })

  after(async () => {
    await network.provider.request({
      method: 'hardhat_reset',
      params: [],
    })
  })
})
