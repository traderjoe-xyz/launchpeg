import { config as hardhatConfig, ethers, network } from 'hardhat'
import { expect } from 'chai'
import { getDefaultLaunchpegConfig, Phase, LaunchpegConfig, initializePhasesFlatLaunchpeg } from './utils/helpers'
import { ContractFactory, Contract, BigNumber, Bytes } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { advanceTimeAndBlock, duration, latest } from './utils/time'

describe('FlatLaunchpeg', () => {
  let flatLaunchpegCF: ContractFactory
  let flatLaunchpeg: Contract
  let batchRevealCF: ContractFactory
  let batchReveal: Contract

  let config: LaunchpegConfig

  let signers: SignerWithAddress[]
  let dev: SignerWithAddress
  let alice: SignerWithAddress
  let bob: SignerWithAddress
  let projectOwner: SignerWithAddress
  let royaltyReceiver: SignerWithAddress

  before(async () => {
    flatLaunchpegCF = await ethers.getContractFactory('FlatLaunchpeg')
    batchRevealCF = await ethers.getContractFactory('BatchReveal')

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
      config.amountForAllowlist
    )
    await flatLaunchpeg.setBatchReveal(batchReveal.address)
    await batchReveal.configure(
      flatLaunchpeg.address,
      config.batchRevealSize,
      config.batchRevealStart,
      config.batchRevealInterval
    )
  }

  beforeEach(async () => {
    config = await getDefaultLaunchpegConfig()
    await deployBatchReveal()
    await deployFlatLaunchpeg()
  })

  describe('Initialize FlatLaunchpeg', () => {
    it('Should allow owner to initialize only once', async () => {
      await expect(
        flatLaunchpeg.initialize(
          'JoePEG',
          'JOEPEG',
          projectOwner.address,
          royaltyReceiver.address,
          config.maxBatchSize,
          config.collectionSize,
          config.amountForDevs,
          config.amountForAllowlist
        )
      ).to.be.revertedWith('Initializable: contract is already initialized')
    })
  })

  describe('Initialize phases', () => {
    it('Should allow owner to update phases if launch has not started', async () => {
      await expect(
        flatLaunchpeg
          .connect(bob)
          .initializePhases(
            config.preMintStartTime,
            config.allowlistStartTime,
            config.publicSaleStartTime,
            config.publicSaleEndTime,
            config.flatAllowlistSalePrice,
            config.flatPublicSalePrice
          )
      ).to.be.revertedWith('PendingOwnableUpgradeable__NotOwner()')

      await initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.NotStarted)
      expect(await flatLaunchpeg.preMintStartTime()).to.be.eq(config.preMintStartTime)
      expect(await flatLaunchpeg.allowlistStartTime()).to.be.eq(config.allowlistStartTime)
      expect(await flatLaunchpeg.publicSaleStartTime()).to.be.eq(config.publicSaleStartTime)
      expect(await flatLaunchpeg.publicSaleEndTime()).to.be.eq(config.publicSaleEndTime)
      expect(await flatLaunchpeg.allowlistPrice()).to.be.eq(config.flatAllowlistSalePrice)
      expect(await flatLaunchpeg.salePrice()).to.be.eq(config.flatPublicSalePrice)

      config.allowlistStartTime = config.allowlistStartTime.add(duration.minutes(30))
      await initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.Allowlist)
      expect(await flatLaunchpeg.allowlistStartTime()).to.be.eq(config.allowlistStartTime)

      await expect(initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.Allowlist)).to.be.revertedWith(
        'Launchpeg__WrongPhase()'
      )
    })

    it('Should revert if pre-mint start is before block timestamp', async () => {
      config.preMintStartTime = BigNumber.from(0)
      await expect(initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.NotStarted)).to.be.revertedWith(
        'Launchpeg__InvalidStartTime()'
      )
    })

    it('Should revert if allowlist is before pre-mint', async () => {
      config.allowlistStartTime = config.preMintStartTime.sub(duration.minutes(20))
      await expect(initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.NotStarted)).to.be.revertedWith(
        'Launchpeg__AllowlistBeforePreMint()'
      )
    })

    it('Should revert if public sale start is before allowlist start', async () => {
      config.publicSaleStartTime = config.allowlistStartTime.sub(duration.minutes(20))
      await expect(initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.NotStarted)).to.be.revertedWith(
        'Launchpeg__PublicSaleBeforeAllowlist()'
      )
    })

    it('Should revert if public sale end time is before public sale start time', async () => {
      config.publicSaleEndTime = config.publicSaleStartTime.sub(duration.minutes(20))
      await expect(initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.NotStarted)).to.be.revertedWith(
        'Launchpeg__PublicSaleEndBeforePublicSaleStart()'
      )
    })

    it('Should revert if allowlist price is higher than public sale price', async () => {
      config.flatAllowlistSalePrice = config.flatPublicSalePrice.add(1)
      await expect(initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.NotStarted)).to.be.revertedWith(
        'Launchpeg__InvalidAllowlistPrice()'
      )
    })
  })

  describe('Configure FlatLaunchpeg times', () => {
    beforeEach(async () => {
      await initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.NotStarted)
    })

    it('Should allow owner to set pre-mint start time', async () => {
      const newPreMintStartTime = config.preMintStartTime.sub(duration.minutes(30))
      await expect(flatLaunchpeg.connect(projectOwner).setPreMintStartTime(newPreMintStartTime)).to.be.revertedWith(
        'PendingOwnableUpgradeable__NotOwner()'
      )

      await flatLaunchpeg.setPreMintStartTime(newPreMintStartTime)
      expect(await flatLaunchpeg.preMintStartTime()).to.eq(newPreMintStartTime)
    })

    it('Should revert if pre-mint is before block timestamp or after allowlist', async () => {
      const blockTimestamp = await latest()
      let invalidPreMintStartTime = blockTimestamp.sub(duration.minutes(30))
      await expect(flatLaunchpeg.setPreMintStartTime(invalidPreMintStartTime)).to.be.revertedWith(
        'Launchpeg__InvalidStartTime()'
      )

      invalidPreMintStartTime = config.allowlistStartTime.add(duration.minutes(30))
      await expect(flatLaunchpeg.setPreMintStartTime(invalidPreMintStartTime)).to.be.revertedWith(
        'Launchpeg__AllowlistBeforePreMint()'
      )
    })

    it('Should revert when setting pre-mint start time before phases are initialized', async () => {
      await deployFlatLaunchpeg()
      const newPreMintStartTime = config.preMintStartTime.sub(duration.minutes(30))
      await expect(flatLaunchpeg.setPreMintStartTime(newPreMintStartTime)).to.be.revertedWith(
        'Launchpeg__NotInitialized()'
      )
    })
  })

  describe('Pre-mint phase', () => {
    beforeEach(async () => {
      await initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.PreMint)
      await flatLaunchpeg.connect(dev).seedAllowlist([alice.address], [5])
    })

    it('Should allow whitelisted user to pre-mint', async () => {
      const allowlistPrice = config.flatAllowlistSalePrice
      const quantity = 1
      await flatLaunchpeg.connect(alice).preMint(quantity, { value: allowlistPrice.mul(quantity) })
      expect(await flatLaunchpeg.amountMintedDuringPreMint()).to.eq(quantity)
    })

    it('Should not allow batch mint during pre-mint phase', async () => {
      const allowlistPrice = config.flatAllowlistSalePrice
      await flatLaunchpeg.connect(alice).preMint(1, { value: allowlistPrice })
      await expect(flatLaunchpeg.connect(bob).batchMintPreMintedNFTs(1)).to.be.revertedWith('Launchpeg__WrongPhase()')
    })

    it('Should revert if user tries to mint for another phase', async () => {
      await expect(flatLaunchpeg.connect(alice).allowlistMint(1)).to.be.revertedWith('Launchpeg__WrongPhase()')
      await expect(flatLaunchpeg.connect(alice).publicSaleMint(1)).to.be.revertedWith('Launchpeg__WrongPhase()')
    })
  })

  describe('Allowlist phase', () => {
    it('Should allow whitelisted user to mint up to allowlist allocation', async () => {
      await initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.Allowlist)
      await flatLaunchpeg.connect(dev).seedAllowlist([bob.address], [2])

      const allowlistPrice = config.flatAllowlistSalePrice
      await flatLaunchpeg.connect(bob).allowlistMint(1, { value: allowlistPrice })
      // send more AVAX to test refund
      await flatLaunchpeg.connect(bob).allowlistMint(1, { value: allowlistPrice.mul(2) })
      expect(await flatLaunchpeg.balanceOf(bob.address)).to.eq(2)

      await expect(flatLaunchpeg.connect(bob).allowlistMint(1, { value: allowlistPrice })).to.be.revertedWith(
        'Launchpeg__NotEligibleForAllowlistMint()'
      )
      await expect(flatLaunchpeg.connect(alice).allowlistMint(1, { value: allowlistPrice })).to.be.revertedWith(
        'Launchpeg__NotEligibleForAllowlistMint()'
      )
    })

    it('Should revert if user pre-mints and allowlist mints more than collection size', async () => {
      config.collectionSize = 5
      config.amountForDevs = 0
      config.amountForAllowlist = 5
      config.batchRevealSize = 5
      await deployFlatLaunchpeg()
      await initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.PreMint)
      await flatLaunchpeg.connect(dev).seedAllowlist([alice.address, bob.address], [5, 5])
      const allowlistPrice = config.flatAllowlistSalePrice

      // Alice pre-mints
      await flatLaunchpeg.connect(alice).preMint(1, { value: allowlistPrice })

      // Bob allowlist mints
      const blockTimestamp = await latest()
      await advanceTimeAndBlock(duration.seconds(config.allowlistStartTime.sub(blockTimestamp).toNumber()))
      await flatLaunchpeg.connect(bob).allowlistMint(4, { value: allowlistPrice.mul(4) })

      await expect(flatLaunchpeg.connect(alice).allowlistMint(1, { value: allowlistPrice })).to.be.revertedWith(
        'Launchpeg__MaxSupplyReached()'
      )
    })

    it('Should revert if user did not send enough funds', async () => {
      await initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.Allowlist)
      await flatLaunchpeg.connect(dev).seedAllowlist([bob.address], [2])

      await expect(flatLaunchpeg.connect(bob).allowlistMint(1)).to.be.revertedWith('Launchpeg__NotEnoughAVAX(0)')
    })

    it('Should allow any user to batch mint', async () => {
      await initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.PreMint)
      await flatLaunchpeg.connect(dev).seedAllowlist([alice.address], [5])

      // Alice pre-mints
      const allowlistPrice = config.flatAllowlistSalePrice
      const preMintQty = 2
      await flatLaunchpeg.connect(alice).preMint(preMintQty, { value: allowlistPrice.mul(preMintQty) })

      // Bob batch mints in allowlist phase
      const blockTimestamp = await latest()
      await advanceTimeAndBlock(duration.seconds(config.allowlistStartTime.sub(blockTimestamp).toNumber()))
      await flatLaunchpeg.connect(bob).batchMintPreMintedNFTs(preMintQty)
      expect(await flatLaunchpeg.balanceOf(alice.address)).to.eq(preMintQty)
    })

    it('Should revert if user tries to mint for another phase', async () => {
      await initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.Allowlist)
      await expect(flatLaunchpeg.connect(alice).preMint(1)).to.be.revertedWith('Launchpeg__WrongPhase()')
      await expect(flatLaunchpeg.connect(alice).publicSaleMint(1)).to.be.revertedWith('Launchpeg__WrongPhase()')
    })
  })

  describe('Public sale phase', () => {
    it('Should allow user to mint up to max batch size', async () => {
      await initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.PublicSale)

      const quantity = config.maxBatchSize
      const price = config.flatPublicSalePrice
      await flatLaunchpeg.connect(bob).publicSaleMint(quantity, { value: price.mul(quantity) })
      expect(await flatLaunchpeg.balanceOf(bob.address)).to.eq(quantity)

      await expect(flatLaunchpeg.connect(bob).publicSaleMint(1, { value: price })).to.be.revertedWith(
        'Launchpeg__CanNotMintThisMany()'
      )
    })

    it('Should revert if user pre-mints and public sale mints more than collection size', async () => {
      config.collectionSize = 5
      config.amountForDevs = 0
      config.amountForAllowlist = 5
      config.batchRevealSize = 5
      await deployFlatLaunchpeg()
      await initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.PreMint)
      await flatLaunchpeg.connect(dev).seedAllowlist([alice.address, bob.address], [5, 5])
      const allowlistPrice = config.flatAllowlistSalePrice
      const publicSalePrice = config.flatPublicSalePrice

      // Alice pre-mints
      await flatLaunchpeg.connect(alice).preMint(1, { value: allowlistPrice })

      // Bob public sale mints
      const blockTimestamp = await latest()
      await advanceTimeAndBlock(duration.seconds(config.publicSaleStartTime.sub(blockTimestamp).toNumber()))
      await flatLaunchpeg.connect(bob).publicSaleMint(4, { value: publicSalePrice.mul(4) })

      await expect(flatLaunchpeg.connect(alice).publicSaleMint(1, { value: publicSalePrice })).to.be.revertedWith(
        'Launchpeg__MaxSupplyReached()'
      )
    })

    it('Should revert if user did not send enough funds', async () => {
      await initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.PublicSale)
      await expect(flatLaunchpeg.connect(alice).publicSaleMint(2)).to.be.revertedWith('Launchpeg__NotEnoughAVAX(0)')
    })

    it('Should revert when max supply is reached', async () => {
      config.collectionSize = 10
      config.amountForDevs = 0
      config.amountForAllowlist = 0
      config.maxBatchSize = 10
      config.batchRevealSize = 10
      await deployFlatLaunchpeg()
      await initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.PublicSale)

      let quantity = 5
      const price = config.flatPublicSalePrice
      await flatLaunchpeg.connect(bob).publicSaleMint(quantity, { value: price.mul(quantity) })

      // Alice mints more than max supply
      await expect(flatLaunchpeg.connect(alice).publicSaleMint(6)).to.be.revertedWith('Launchpeg__MaxSupplyReached()')

      // Bob mints up to max supply - phase ends
      await flatLaunchpeg.connect(bob).publicSaleMint(quantity, { value: price.mul(quantity) })

      await expect(flatLaunchpeg.connect(alice).publicSaleMint(1)).to.be.revertedWith('Launchpeg__WrongPhase()')
    })

    it('Should allow any user to batch mint', async () => {
      await initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.PreMint)
      await flatLaunchpeg.connect(dev).seedAllowlist([alice.address], [5])

      // Alice pre-mints
      const allowlistPrice = config.flatAllowlistSalePrice
      const preMintQty = 2
      await flatLaunchpeg.connect(alice).preMint(preMintQty, { value: allowlistPrice.mul(preMintQty) })

      // Bob batch mints in public sale phase
      const blockTimestamp = await latest()
      await advanceTimeAndBlock(duration.seconds(config.publicSaleStartTime.sub(blockTimestamp).toNumber()))
      await flatLaunchpeg.connect(bob).batchMintPreMintedNFTs(preMintQty)
      expect(await flatLaunchpeg.balanceOf(alice.address)).to.eq(preMintQty)
    })

    it('Should revert if user tries to mint for another phase', async () => {
      await initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.PublicSale)
      await expect(flatLaunchpeg.connect(alice).preMint(1)).to.be.revertedWith('Launchpeg__WrongPhase()')
      await expect(flatLaunchpeg.connect(alice).allowlistMint(1)).to.be.revertedWith('Launchpeg__WrongPhase()')
    })

    it('Should revert when public sale has ended', async () => {
      await initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.Ended)
      await expect(flatLaunchpeg.connect(alice).publicSaleMint(1)).to.be.revertedWith('Launchpeg__WrongPhase()')
    })
  })

  describe('Pause FlatLaunchpeg methods', () => {
    let PAUSER_ROLE: Bytes
    let UNPAUSER_ROLE: Bytes

    beforeEach(async () => {
      PAUSER_ROLE = await flatLaunchpeg.PAUSER_ROLE()
      UNPAUSER_ROLE = await flatLaunchpeg.UNPAUSER_ROLE()
    })

    it('Should allow owner or pauser to pause mint methods', async () => {
      await initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.PublicSale)
      await flatLaunchpeg.grantRole(PAUSER_ROLE, alice.address)
      await flatLaunchpeg.connect(alice).pause()
      await expect(flatLaunchpeg.devMint(1)).to.be.revertedWith('Pausable: paused')
      await expect(flatLaunchpeg.preMint(1)).to.be.revertedWith('Pausable: paused')
      await expect(flatLaunchpeg.batchMintPreMintedNFTs(1)).to.be.revertedWith('Pausable: paused')
      await expect(flatLaunchpeg.allowlistMint(1)).to.be.revertedWith('Pausable: paused')
      await expect(flatLaunchpeg.connect(bob).publicSaleMint(1)).to.be.revertedWith('Pausable: paused')

      await flatLaunchpeg.grantRole(UNPAUSER_ROLE, alice.address)
      await flatLaunchpeg.connect(alice).unpause()
      await flatLaunchpeg.connect(bob).publicSaleMint(1, { value: config.flatPublicSalePrice })
    })
  })

  after(async () => {
    await network.provider.request({
      method: 'hardhat_reset',
      params: [],
    })
  })
})
