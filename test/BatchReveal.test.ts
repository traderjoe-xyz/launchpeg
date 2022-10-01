import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { ContractFactory, Contract, BigNumber, Bytes } from 'ethers'
import { config as hardhatConfig, ethers, network } from 'hardhat'
import { initializePhasesLaunchpeg, getDefaultLaunchpegConfig, Phase, LaunchpegConfig } from './utils/helpers'
import { advanceTimeAndBlock, latest, duration } from './utils/time'

describe('BatchReveal', () => {
  let launchpegCF: ContractFactory
  let batchRevealCF: ContractFactory
  let coordinatorMockCF: ContractFactory
  let launchpeg: Contract
  let batchReveal: Contract
  let coordinatorMock: Contract

  let config: LaunchpegConfig

  let signers: SignerWithAddress[]
  let dev: SignerWithAddress
  let alice: SignerWithAddress
  let bob: SignerWithAddress
  let projectOwner: SignerWithAddress
  let royaltyReceiver: SignerWithAddress

  before(async () => {
    launchpegCF = await ethers.getContractFactory('Launchpeg')
    batchRevealCF = await ethers.getContractFactory('BatchReveal')
    coordinatorMockCF = await ethers.getContractFactory('VRFCoordinatorV2Mock')

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
          live: false,
          saveDeployments: true,
          tags: ['test', 'local'],
        },
      ],
    })
  })

  const deployBatchReveal = async () => {
    batchReveal = await batchRevealCF.deploy()
    await batchReveal.initialize()
  }

  const deployLaunchpeg = async (enableBatchReveal: boolean = true) => {
    launchpeg = await launchpegCF.deploy()
    await launchpeg.initialize(
      'JoePEG',
      'JOEPEG',
      projectOwner.address,
      royaltyReceiver.address,
      config.maxBatchSize,
      config.collectionSize,
      config.amountForAuction,
      config.amountForAllowlist,
      config.amountForDevs
    )
    if (enableBatchReveal) {
      await batchReveal.configure(
        launchpeg.address,
        config.batchRevealSize,
        config.batchRevealStart,
        config.batchRevealInterval
      )
      await launchpeg.setBatchReveal(batchReveal.address)
    }
  }

  beforeEach(async () => {
    config = await getDefaultLaunchpegConfig()
    await deployBatchReveal()
    await deployLaunchpeg()
  })

  describe('Initialize BatchReveal', () => {
    it('Should allow owner to initialize only once', async () => {
      await expect(batchReveal.initialize()).to.be.revertedWith('Initializable: contract is already initialized')
    })
  })

  describe('Configure BatchReveal', () => {
    it('Should allow owner to configure batch reveal', async () => {
      await expect(
        batchReveal
          .connect(alice)
          .configure(launchpeg.address, config.batchRevealSize, config.batchRevealStart, config.batchRevealInterval)
      ).to.be.revertedWith('Ownable: caller is not the owner')

      const batchRevealConfig = await batchReveal.launchpegToConfig(launchpeg.address)
      expect(batchRevealConfig.collectionSize).to.eq(config.collectionSize)
      expect(batchRevealConfig.intCollectionSize).to.eq(config.collectionSize)
      expect(batchRevealConfig.revealBatchSize).to.eq(config.batchRevealSize)
      expect(batchRevealConfig.revealStartTime).to.eq(config.batchRevealStart)
      expect(batchRevealConfig.revealInterval).to.eq(config.batchRevealInterval)
    })

    it('Should revert when owner configures after batch reveal starts', async () => {
      config.batchRevealSize = 10
      await deployLaunchpeg()
      await initializePhasesLaunchpeg(launchpeg, config, Phase.Reveal)

      await launchpeg.connect(projectOwner).devMint(config.batchRevealSize)
      await launchpeg.connect(alice).revealNextBatch()
      await expect(
        batchReveal.configure(
          launchpeg.address,
          config.batchRevealSize,
          config.batchRevealStart,
          config.batchRevealInterval
        )
      ).to.be.revertedWith('Launchpeg__BatchRevealStarted()')

      await expect(batchReveal.setRevealBatchSize(launchpeg.address, config.batchRevealSize)).to.be.revertedWith(
        'Launchpeg__BatchRevealStarted()'
      )

      await expect(batchReveal.setRevealStartTime(launchpeg.address, config.batchRevealStart)).to.be.revertedWith(
        'Launchpeg__BatchRevealStarted()'
      )

      await expect(batchReveal.setRevealInterval(launchpeg.address, config.batchRevealInterval)).to.be.revertedWith(
        'Launchpeg__BatchRevealStarted()'
      )
    })

    it('Should allow owner to set reveal batch size', async () => {
      const revealBatchSize = 10

      await expect(
        batchReveal.connect(alice).setRevealBatchSize(launchpeg.address, revealBatchSize)
      ).to.be.revertedWith('Ownable: caller is not the owner')

      batchReveal.setRevealBatchSize(launchpeg.address, revealBatchSize)

      const batchRevealConfig = await batchReveal.launchpegToConfig(launchpeg.address)
      expect(batchRevealConfig.revealBatchSize).to.eq(revealBatchSize)
    })

    it('Should revert if reveal batch size is invalid', async () => {
      await expect(batchReveal.setRevealBatchSize(launchpeg.address, 0)).to.be.revertedWith(
        'Launchpeg__InvalidBatchRevealSize()'
      )

      await expect(batchReveal.setRevealBatchSize(launchpeg.address, config.batchRevealSize + 1)).to.be.revertedWith(
        'Launchpeg__InvalidBatchRevealSize()'
      )

      await expect(batchReveal.setRevealBatchSize(launchpeg.address, config.collectionSize + 1)).to.be.revertedWith(
        'Launchpeg__InvalidBatchRevealSize()'
      )
    })

    it('Should allow owner to set reveal start time', async () => {
      const revealStartTime = config.batchRevealStart.sub(duration.minutes(10))

      await expect(
        batchReveal.connect(alice).setRevealStartTime(launchpeg.address, revealStartTime)
      ).to.be.revertedWith('Ownable: caller is not the owner')

      batchReveal.setRevealStartTime(launchpeg.address, revealStartTime)

      const batchRevealConfig = await batchReveal.launchpegToConfig(launchpeg.address)
      expect(batchRevealConfig.revealStartTime).to.eq(revealStartTime)
    })

    it('Should revert if reveal start time is invalid', async () => {
      const batchRevealStart = config.batchRevealStart.add(8_640_000)
      await expect(batchReveal.setRevealStartTime(launchpeg.address, batchRevealStart)).to.be.revertedWith(
        'Launchpeg__InvalidRevealDates()'
      )
    })

    it('Should allow owner to set reveal interval', async () => {
      const revealInterval = config.batchRevealInterval.sub(duration.minutes(10))

      await expect(batchReveal.connect(alice).setRevealInterval(launchpeg.address, revealInterval)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )

      batchReveal.setRevealInterval(launchpeg.address, revealInterval)

      const batchRevealConfig = await batchReveal.launchpegToConfig(launchpeg.address)
      expect(batchRevealConfig.revealInterval).to.eq(revealInterval)
    })

    it('Should revert if reveal interval is invalid', async () => {
      const revealInterval = 864_001
      await expect(batchReveal.setRevealInterval(launchpeg.address, revealInterval)).to.be.revertedWith(
        'Launchpeg__InvalidRevealDates()'
      )
    })

    it('Should revert when setting batch reveal config if batch reveal is not initialized', async () => {
      await deployLaunchpeg(false)
      await expect(batchReveal.setRevealBatchSize(launchpeg.address, config.batchRevealSize)).to.be.revertedWith(
        'Launchpeg__BatchRevealNotInitialized()'
      )

      await expect(batchReveal.setRevealStartTime(launchpeg.address, config.batchRevealStart)).to.be.revertedWith(
        'Launchpeg__BatchRevealNotInitialized()'
      )

      await expect(batchReveal.setRevealInterval(launchpeg.address, config.batchRevealInterval)).to.be.revertedWith(
        'Launchpeg__BatchRevealNotInitialized()'
      )
    })
  })

  describe('VRF', () => {
    const setVRF = async () => {
      await batchReveal.setVRF(coordinatorMock.address, ethers.utils.formatBytes32String('Oxff'), 1, 200_000)
    }

    beforeEach(async () => {
      coordinatorMock = await coordinatorMockCF.deploy(1, 1)
      await coordinatorMock.createSubscription()
      await coordinatorMock.fundSubscription(1, 1_000_000)
      await coordinatorMock.addKeyHash(ethers.utils.formatBytes32String('Oxff'))

      config.collectionSize = 50
      config.amountForDevs = 50
      config.amountForAuction = 0
      config.amountForAllowlist = 0
      config.batchRevealSize = 10
      config.batchRevealStart = BigNumber.from(0)
      config.batchRevealInterval = BigNumber.from(0)
      await deployLaunchpeg()
      await initializePhasesLaunchpeg(launchpeg, config, Phase.DutchAuction)
      await coordinatorMock.addConsumer(0, batchReveal.address)
      await setVRF()
      await launchpeg.setBaseURI('base/')
      await launchpeg.setUnrevealedURI('unrevealed')
    })

    it('Initialisation checks', async () => {
      await expect(
        batchReveal.setVRF(ethers.constants.AddressZero, ethers.utils.formatBytes32String('Oxff'), 1, 200_000)
      ).to.be.revertedWith('Launchpeg__InvalidCoordinator()')

      await expect(
        batchReveal.setVRF(coordinatorMock.address, ethers.utils.formatBytes32String('Oxff'), 1, 0)
      ).to.be.revertedWith('Launchpeg__InvalidCallbackGasLimit()')

      await expect(
        batchReveal.setVRF(coordinatorMock.address, ethers.utils.formatBytes32String('Ox00'), 1, 200_000)
      ).to.be.revertedWith('Launchpeg__InvalidKeyHash()')

      await coordinatorMock.removeConsumer(0, ethers.constants.AddressZero)
      await coordinatorMock.addConsumer(0, launchpeg.address)
      await expect(
        batchReveal.setVRF(coordinatorMock.address, ethers.utils.formatBytes32String('Oxff'), 1, 200_000)
      ).to.be.revertedWith('Launchpeg__IsNotInTheConsumerList()')
    })

    it('Should draw correctly', async () => {
      await launchpeg.connect(projectOwner).devMint(config.batchRevealSize)
      await launchpeg.revealNextBatch()
      // URIs are not revealed before Chainlink's coordinator response
      expect(await launchpeg.tokenURI(3)).to.eq('unrevealed')

      await coordinatorMock.fulfillRandomWords(1, batchReveal.address)
      const token3URI = await launchpeg.tokenURI(3)
      expect(token3URI).to.contains('base')
      expect(await launchpeg.tokenURI(3 + config.batchRevealSize)).to.eq('unrevealed')

      await launchpeg.connect(projectOwner).devMint(config.batchRevealSize)
      await launchpeg.revealNextBatch()
      await coordinatorMock.fulfillRandomWords(2, batchReveal.address)
      expect(await launchpeg.tokenURI(3)).to.eq(token3URI)
      expect(await launchpeg.tokenURI(3 + config.batchRevealSize)).to.contains('base')
      expect(await launchpeg.tokenURI(3 + 2 * config.batchRevealSize)).to.eq('unrevealed')
    })

    it('Should be able to force reveal if VRF fails', async () => {
      await launchpeg.connect(projectOwner).devMint(config.batchRevealSize)
      await launchpeg.revealNextBatch()
      expect(await launchpeg.tokenURI(3)).to.eq('unrevealed')

      await batchReveal.connect(dev).forceReveal(launchpeg.address)
      const token3URI = await launchpeg.tokenURI(3)
      expect(token3URI).to.contains('base')
      expect(await launchpeg.tokenURI(3 + config.batchRevealSize)).to.eq('unrevealed')

      // Coordinator's response coming too late
      await coordinatorMock.fulfillRandomWords(1, launchpeg.address)
      // Doesn't reveal anything
      expect(await launchpeg.tokenURI(3 + config.batchRevealSize)).to.eq('unrevealed')
      expect(await launchpeg.tokenURI(3)).to.eq(token3URI)
    })

    it('Should revert when fulfilling random words if collection has been force revealed', async () => {
      await launchpeg.connect(projectOwner).devMint(config.batchRevealSize)
      await launchpeg.revealNextBatch()

      await batchReveal.forceReveal(launchpeg.address)
      await coordinatorMock.fulfillRandomWords(1, batchReveal.address)
    })

    it('Should not be able to spam VRF requests', async () => {
      await launchpeg.connect(projectOwner).devMint(config.batchRevealSize)
      await launchpeg.revealNextBatch()
      await expect(launchpeg.revealNextBatch()).to.be.revertedWith('Launchpeg__RevealNextBatchNotAvailable()')
    })
  })

  describe('Reveal batch', () => {
    it('Should allow owner to force reveal if the collection does not sell out', async () => {
      await initializePhasesLaunchpeg(launchpeg, config, Phase.PublicSale)

      // No one bought the collection :(
      await launchpeg.connect(projectOwner).devMint(config.amountForDevs)

      // Should fail since not enough tokens have been minted for a reveal
      await expect(launchpeg.connect(bob).revealNextBatch()).to.be.revertedWith(
        'Launchpeg__RevealNextBatchNotAvailable()'
      )

      await expect(batchReveal.connect(bob).forceReveal(launchpeg.address)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )

      await batchReveal.connect(dev).forceReveal(launchpeg.address)

      // Batch 1 is revealed
      expect(await launchpeg.tokenURI(0)).to.contains(config.baseTokenURI)
      expect(await launchpeg.tokenURI(config.batchRevealSize)).to.eq(config.unrevealedTokenURI)
    })

    it('Should revert if revealNextBatch() is not called by Launchpeg contract', async () => {
      await expect(batchReveal.revealNextBatch(launchpeg.address, 123)).to.be.revertedWith('Launchpeg__Unauthorized()')
    })
  })

  after(async () => {
    await network.provider.request({
      method: 'hardhat_reset',
      params: [],
    })
  })
})
