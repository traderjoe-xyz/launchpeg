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

  let PAUSER_ROLE: Bytes
  let UNPAUSER_ROLE: Bytes

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
    config = { ...(await getDefaultLaunchpegConfig()) }
    await deployBatchReveal()
    await deployFlatLaunchpeg()
  })

  describe('Initialization', () => {
    it('Should not allow collection size to be 0', async () => {
      config.collectionSize = 0
      config.batchRevealSize = 0
      await expect(deployFlatLaunchpeg()).to.be.revertedWith('Launchpeg__LargerCollectionSizeNeeded()')
    })

    it('Phases can be updated', async () => {
      await initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.NotStarted)

      config.allowlistStartTime = config.allowlistStartTime.add(120)
      await initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.NotStarted)
      expect(await flatLaunchpeg.allowlistStartTime()).to.be.eq(config.allowlistStartTime)
    })

    it('Sale dates should be correct', async () => {
      config.preMintStartTime = BigNumber.from(0)
      await expect(initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.Allowlist)).to.be.revertedWith(
        'Launchpeg__InvalidStartTime()'
      )
    })

    it('Allowlist must happen after pre-mint', async () => {
      config.allowlistStartTime = config.preMintStartTime.sub(duration.minutes(20))

      await expect(initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.Allowlist)).to.be.revertedWith(
        'Launchpeg__AllowlistBeforePreMint()'
      )
    })

    it('Public sale must happen after allowlist', async () => {
      config.publicSaleStartTime = config.allowlistStartTime.sub(duration.minutes(20))

      await expect(initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.Allowlist)).to.be.revertedWith(
        'Launchpeg__PublicSaleBeforeAllowlist()'
      )
    })

    it('Public sale end time must be after public sale start time', async () => {
      config.publicSaleEndTime = config.publicSaleStartTime.sub(duration.minutes(20))

      await expect(initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.Allowlist)).to.be.revertedWith(
        'Launchpeg__PublicSaleEndBeforePublicSaleStart()'
      )
    })

    it('Allowlist price should be lower than Public sale', async () => {
      config.flatAllowlistSalePrice = config.flatAllowlistSalePrice.mul(10)
      await expect(initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.NotStarted)).to.be.revertedWith(
        'Launchpeg__InvalidAllowlistPrice()'
      )
    })

    it('Should not allow 0 batch reveal size', async () => {
      config.batchRevealSize = 0
      await expect(deployFlatLaunchpeg()).to.be.revertedWith('Launchpeg__InvalidBatchRevealSize()')
    })

    it('Should not allow invalid reveal batch size', async () => {
      config.batchRevealSize = config.batchRevealSize + 1
      await expect(deployFlatLaunchpeg()).to.be.revertedWith('Launchpeg__InvalidBatchRevealSize()')
    })

    it('Should not allow invalid reveal start time', async () => {
      config.batchRevealStart = config.batchRevealStart.add(8_640_000)
      await expect(deployFlatLaunchpeg()).to.be.revertedWith('Launchpeg__InvalidRevealDates()')
    })

    it('Should not allow invalid reveal interval', async () => {
      config.batchRevealInterval = config.batchRevealInterval.add(864_000)
      await expect(deployFlatLaunchpeg()).to.be.revertedWith('Launchpeg__InvalidRevealDates()')
    })

    it('Reverts when setting pre-mint start time before phases are initialized', async () => {
      const newPreMintStartTime = config.preMintStartTime.sub(duration.minutes(30))
      await expect(flatLaunchpeg.setPreMintStartTime(newPreMintStartTime)).to.be.revertedWith(
        'Launchpeg__NotInitialized()'
      )
    })

    it('Reverts when setting allowlist start time before phases are initialized', async () => {
      const newAllowlistStartTime = config.allowlistStartTime.sub(duration.minutes(30))
      await expect(flatLaunchpeg.setAllowlistStartTime(newAllowlistStartTime)).to.be.revertedWith(
        'Launchpeg__NotInitialized()'
      )
    })

    it('Reverts when setting public sale start time before phases are initialized', async () => {
      const newPublicSaleStartTime = config.publicSaleStartTime.sub(duration.minutes(30))
      await expect(flatLaunchpeg.setPublicSaleStartTime(newPublicSaleStartTime)).to.be.revertedWith(
        'Launchpeg__NotInitialized()'
      )
    })

    it('Reverts when setting public sale end time before phases are initialized', async () => {
      const newPublicSaleEndTime = config.publicSaleEndTime.sub(duration.minutes(30))
      await expect(flatLaunchpeg.setPublicSaleEndTime(newPublicSaleEndTime)).to.be.revertedWith(
        'Launchpeg__NotInitialized()'
      )
    })
  })

  describe('Project owner mint', () => {
    it('Mint', async () => {
      await flatLaunchpeg.connect(projectOwner).devMint(config.amountForDevs)
      expect(await flatLaunchpeg.balanceOf(projectOwner.address)).to.eq(config.amountForDevs)
    })

    it('Only dev can mint', async () => {
      await expect(flatLaunchpeg.connect(alice).devMint(1)).to.be.revertedWith(
        'SafeAccessControlEnumerableUpgradeable__SenderMissingRoleAndIsNotOwner'
      )
    })

    it('Mint after project owner changes', async () => {
      await flatLaunchpeg.connect(dev).grantRole(flatLaunchpeg.PROJECT_OWNER_ROLE(), alice.address)
      await flatLaunchpeg.connect(alice).devMint(config.amountForDevs)
      expect(await flatLaunchpeg.balanceOf(alice.address)).to.eq(config.amountForDevs)
    })
  })

  describe('Pre-mint phase', () => {
    beforeEach(async () => {
      await initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.PreMint)
      await flatLaunchpeg.connect(dev).seedAllowlist([alice.address], [5])
    })

    it('Should allow whitelisted user to pre-mint', async () => {
      const quantity = 1
      await flatLaunchpeg.connect(alice).preMint(quantity, { value: config.flatAllowlistSalePrice.mul(quantity) })
      expect(await flatLaunchpeg.userAddressToPreMintAmount(alice.address)).to.eq(quantity)
      expect(await flatLaunchpeg.amountMintedDuringPreMint()).to.eq(quantity)

      await expect(flatLaunchpeg.connect(bob).preMint(1, { value: config.flatAllowlistSalePrice })).to.be.revertedWith(
        'Launchpeg__NotEligibleForAllowlistMint'
      )
    })

    it('Should receive allowlist price per NFT', async () => {
      const quantity = 2
      await flatLaunchpeg.connect(alice).preMint(quantity, { value: config.flatAllowlistSalePrice.mul(quantity) })
      expect(await flatLaunchpeg.userAddressToPreMintAmount(alice.address)).to.eq(quantity)

      await expect(flatLaunchpeg.connect(alice).preMint(1)).to.be.revertedWith('Launchpeg__NotEnoughAVAX(0)')
    })

    it('Should allow user to pre-mint up to allowlist allocation', async () => {
      const allowlistQty = await flatLaunchpeg.allowlist(alice.address)
      const quantity = 3
      const remQuantity = allowlistQty - quantity
      await flatLaunchpeg.connect(alice).preMint(quantity, { value: config.flatAllowlistSalePrice.mul(quantity) })
      expect(await flatLaunchpeg.userAddressToPreMintAmount(alice.address)).to.eq(quantity)
      expect(await flatLaunchpeg.allowlist(alice.address)).to.eq(remQuantity)

      await expect(
        flatLaunchpeg
          .connect(alice)
          .preMint(remQuantity + 1, { value: config.flatAllowlistSalePrice.mul(remQuantity + 1) })
      ).to.be.revertedWith('Launchpeg__NotEligibleForAllowlistMint()')

      await flatLaunchpeg.connect(alice).preMint(remQuantity, { value: config.flatAllowlistSalePrice.mul(remQuantity) })
      expect(await flatLaunchpeg.userAddressToPreMintAmount(alice.address)).to.eq(quantity + remQuantity)
    })

    it('Should not allow 0 pre-mint amount', async () => {
      await expect(flatLaunchpeg.connect(alice).preMint(0)).to.be.revertedWith('Launchpeg__InvalidQuantity()')
    })

    it('Should not transfer pre-minted NFT to user', async () => {
      await flatLaunchpeg.connect(alice).preMint(1, { value: config.flatAllowlistSalePrice })
      expect(await flatLaunchpeg.userAddressToPreMintAmount(alice.address)).to.eq(1)
      expect(await flatLaunchpeg.balanceOf(alice.address)).to.eq(0)
    })

    it('Should allow users to pre-mint up to allowlist amount', async () => {
      config = { ...(await getDefaultLaunchpegConfig()) }
      config.amountForAllowlist = 5
      await deployFlatLaunchpeg()
      await initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.PreMint)
      await flatLaunchpeg.connect(dev).seedAllowlist([alice.address, bob.address], [5, 4])

      const aliceQty = 4
      const bobQty = 1
      await flatLaunchpeg.connect(alice).preMint(aliceQty, { value: config.flatAllowlistSalePrice.mul(aliceQty) })
      await flatLaunchpeg.connect(bob).preMint(bobQty, { value: config.flatAllowlistSalePrice.mul(bobQty) })

      await expect(
        flatLaunchpeg.connect(bob).preMint(bobQty, { value: config.flatAllowlistSalePrice.mul(bobQty) })
      ).to.be.revertedWith('Launchpeg__MaxSupplyReached()')

      expect(await flatLaunchpeg.userAddressToPreMintAmount(alice.address)).to.eq(aliceQty)
      expect(await flatLaunchpeg.userAddressToPreMintAmount(bob.address)).to.eq(bobQty)
      expect(await flatLaunchpeg.amountMintedDuringPreMint()).to.eq(aliceQty + bobQty)
    })

    it('Should not allow batch mint during pre-mint phase', async () => {
      await flatLaunchpeg.connect(alice).preMint(1, { value: config.flatAllowlistSalePrice })
      await expect(flatLaunchpeg.connect(bob).batchMintPreMintedNFTs(1)).to.be.revertedWith('Launchpeg__WrongPhase()')
    })
  })

  describe('Allowlist phase', () => {
    it('One NFT is transfered when user is on allowlist', async () => {
      await initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.Allowlist)

      await flatLaunchpeg.connect(dev).seedAllowlist([bob.address], [1])
      await flatLaunchpeg.connect(bob).allowlistMint(1, { value: config.flatAllowlistSalePrice })
      expect(await flatLaunchpeg.balanceOf(bob.address)).to.eq(1)
    })

    it('Mint reverts when not started yet', async () => {
      await initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.NotStarted)

      await expect(flatLaunchpeg.connect(bob).allowlistMint(1)).to.be.revertedWith('Launchpeg__WrongPhase()')
    })

    it('Mint reverts when the allowlist sale is over', async () => {
      await initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.PublicSale)

      await expect(flatLaunchpeg.connect(bob).allowlistMint(1)).to.be.revertedWith('Launchpeg__WrongPhase()')
    })

    it('Mint reverts when user tries to mint more NFTs than allowed', async () => {
      await initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.Allowlist)
      const price = config.flatAllowlistSalePrice

      await flatLaunchpeg.connect(dev).seedAllowlist([bob.address], [2])
      await flatLaunchpeg.connect(bob).allowlistMint(1, { value: price.mul(2) }) // intentionally sending more AVAX to test refund
      await flatLaunchpeg.connect(bob).allowlistMint(1, { value: price })

      await expect(flatLaunchpeg.connect(bob).allowlistMint(1, { value: price })).to.be.revertedWith(
        'Launchpeg__NotEligibleForAllowlistMint()'
      )
      expect(await flatLaunchpeg.balanceOf(bob.address)).to.eq(2)
    })

    it('Mint reverts when user tries to mint more NFTs than allowlist amount', async () => {
      config.amountForAllowlist = 5
      await deployFlatLaunchpeg()
      await initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.Allowlist)

      const price = config.flatAllowlistSalePrice
      await flatLaunchpeg.connect(dev).seedAllowlist([alice.address, bob.address], [5, 5])
      await flatLaunchpeg.connect(bob).allowlistMint(5, { value: price.mul(5) })
      await expect(flatLaunchpeg.connect(alice).allowlistMint(1, { value: price })).to.be.revertedWith(
        'Launchpeg__MaxSupplyReached()'
      )
    })

    it('Mint reverts when the caller is not on allowlist during mint phase', async () => {
      await initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.Allowlist)
      await expect(flatLaunchpeg.connect(bob).allowlistMint(1)).to.be.revertedWith(
        'Launchpeg__NotEligibleForAllowlistMint()'
      )
    })

    it("Mint reverts when the caller didn't send enough AVAX", async () => {
      await initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.Allowlist)
      await flatLaunchpeg.connect(dev).seedAllowlist([alice.address], [1])
      await expect(flatLaunchpeg.connect(alice).allowlistMint(1)).to.be.revertedWith('Launchpeg__NotEnoughAVAX(0)')
    })

    it('Seed allowlist reverts when addresses does not match numSlots length', async () => {
      await expect(flatLaunchpeg.connect(dev).seedAllowlist([alice.address, bob.address], [1])).to.be.revertedWith(
        'Launchpeg__WrongAddressesAndNumSlotsLength()'
      )
    })

    it('Should allow any user to batch mint', async () => {
      await initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.PreMint)
      await flatLaunchpeg.connect(dev).seedAllowlist([alice.address, bob.address], [10, 5])

      // Alice and Bob pre-mint
      const alicePreMintQty = 10
      const bobPreMintQty = 5
      await flatLaunchpeg
        .connect(alice)
        .preMint(alicePreMintQty, { value: config.flatAllowlistSalePrice.mul(alicePreMintQty) })
      await flatLaunchpeg
        .connect(bob)
        .preMint(bobPreMintQty, { value: config.flatAllowlistSalePrice.mul(bobPreMintQty) })
      const blockTimestamp = await latest()
      await advanceTimeAndBlock(duration.seconds(config.allowlistStartTime.sub(blockTimestamp).toNumber()))
      expect(await flatLaunchpeg.balanceOf(alice.address)).to.eq(0)
      expect(await flatLaunchpeg.balanceOf(bob.address)).to.eq(0)

      // Bob batch mints
      await flatLaunchpeg.connect(bob).batchMintPreMintedNFTs(5)
      expect(await flatLaunchpeg.balanceOf(alice.address)).to.eq(5)
      expect(await flatLaunchpeg.balanceOf(bob.address)).to.eq(0)

      // Alice batch mints more than available in queue
      await flatLaunchpeg.connect(alice).batchMintPreMintedNFTs(20)
      expect(await flatLaunchpeg.balanceOf(alice.address)).to.eq(10)
      expect(await flatLaunchpeg.balanceOf(bob.address)).to.eq(5)
      expect(await flatLaunchpeg.amountBatchMinted()).to.eq(15)
      expect(await flatLaunchpeg.userAddressToPreMintAmount(alice.address)).to.eq(0)
      expect(await flatLaunchpeg.userAddressToPreMintAmount(bob.address)).to.eq(0)

      await expect(flatLaunchpeg.batchMintPreMintedNFTs(5)).to.be.revertedWith(
        'Launchpeg__MaxSupplyForBatchMintReached()'
      )
    })

    it('Should revert when there are no NFTs to batch mint', async () => {
      await initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.Allowlist)
      await expect(flatLaunchpeg.batchMintPreMintedNFTs(0)).to.be.revertedWith('Launchpeg__InvalidQuantity()')
      await expect(flatLaunchpeg.batchMintPreMintedNFTs(5)).to.be.revertedWith(
        'Launchpeg__MaxSupplyForBatchMintReached()'
      )
    })

    it('Owner can set pre-mint start time', async () => {
      let invalidPreMintStartTime = BigNumber.from(0)
      const newPreMintStartTime = config.preMintStartTime.add(duration.minutes(30))
      await initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.PreMint)
      await expect(flatLaunchpeg.connect(projectOwner).setPreMintStartTime(newPreMintStartTime)).to.be.revertedWith(
        'PendingOwnableUpgradeable__NotOwner()'
      )
      await expect(flatLaunchpeg.setPreMintStartTime(invalidPreMintStartTime)).to.be.revertedWith(
        'Launchpeg__InvalidStartTime()'
      )
      invalidPreMintStartTime = config.allowlistStartTime.add(duration.minutes(30))
      await expect(flatLaunchpeg.setPreMintStartTime(invalidPreMintStartTime)).to.be.revertedWith(
        'Launchpeg__AllowlistBeforePreMint()'
      )
      await flatLaunchpeg.setPreMintStartTime(newPreMintStartTime)
      expect(await flatLaunchpeg.preMintStartTime()).to.eq(newPreMintStartTime)
    })

    it('Owner can set allowlist start time', async () => {
      let invalidAllowlistStartTime = BigNumber.from(0)
      const newAllowlistStartTime = config.allowlistStartTime.add(duration.minutes(30))
      await initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.Allowlist)
      await expect(flatLaunchpeg.connect(projectOwner).setAllowlistStartTime(newAllowlistStartTime)).to.be.revertedWith(
        'PendingOwnableUpgradeable__NotOwner()'
      )
      await expect(flatLaunchpeg.setAllowlistStartTime(invalidAllowlistStartTime)).to.be.revertedWith(
        'Launchpeg__AllowlistBeforePreMint()'
      )
      invalidAllowlistStartTime = config.publicSaleStartTime.add(duration.minutes(30))
      await expect(flatLaunchpeg.setAllowlistStartTime(invalidAllowlistStartTime)).to.be.revertedWith(
        'Launchpeg__PublicSaleBeforeAllowlist()'
      )
      await flatLaunchpeg.setAllowlistStartTime(newAllowlistStartTime)
      expect(await flatLaunchpeg.allowlistStartTime()).to.eq(newAllowlistStartTime)
    })

    it('Owner can set public sale start time', async () => {
      let invalidPublicSaleStartTime = config.allowlistStartTime.sub(duration.minutes(30))
      const newPublicSaleStartTime = config.publicSaleStartTime.sub(duration.minutes(30))
      await initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.Allowlist)
      await expect(
        flatLaunchpeg.connect(projectOwner).setPublicSaleStartTime(newPublicSaleStartTime)
      ).to.be.revertedWith('PendingOwnableUpgradeable__NotOwner()')
      await expect(flatLaunchpeg.setPublicSaleStartTime(invalidPublicSaleStartTime)).to.be.revertedWith(
        'Launchpeg__PublicSaleBeforeAllowlist()'
      )
      invalidPublicSaleStartTime = config.publicSaleEndTime.add(duration.minutes(30))
      await expect(flatLaunchpeg.setPublicSaleStartTime(invalidPublicSaleStartTime)).to.be.revertedWith(
        'Launchpeg__PublicSaleEndBeforePublicSaleStart()'
      )
      await flatLaunchpeg.setPublicSaleStartTime(newPublicSaleStartTime)
      expect(await flatLaunchpeg.publicSaleStartTime()).to.eq(newPublicSaleStartTime)
    })

    it('Owner can set public sale end time', async () => {
      const invalidPublicSaleEndTime = config.publicSaleStartTime.sub(duration.minutes(30))
      const newPublicSaleEndTime = config.publicSaleEndTime.sub(duration.minutes(30))
      await initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.Allowlist)
      await expect(flatLaunchpeg.connect(projectOwner).setPublicSaleEndTime(newPublicSaleEndTime)).to.be.revertedWith(
        'PendingOwnableUpgradeable__NotOwner()'
      )
      await expect(flatLaunchpeg.setPublicSaleEndTime(invalidPublicSaleEndTime)).to.be.revertedWith(
        'Launchpeg__PublicSaleEndBeforePublicSaleStart()'
      )
      await flatLaunchpeg.setPublicSaleEndTime(newPublicSaleEndTime)
      expect(await flatLaunchpeg.publicSaleEndTime()).to.eq(newPublicSaleEndTime)
    })

    it('Should allow owner to set reveal batch size', async () => {
      const invalidRevealBatchSize = 101
      const newRevealBatchSize = 100
      await initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.Allowlist)
      await expect(
        batchReveal.connect(projectOwner).setRevealBatchSize(flatLaunchpeg.address, newRevealBatchSize)
      ).to.be.revertedWith('Ownable: caller is not the owner')
      await expect(batchReveal.setRevealBatchSize(flatLaunchpeg.address, invalidRevealBatchSize)).to.be.revertedWith(
        'Launchpeg__InvalidBatchRevealSize()'
      )
      await batchReveal.setRevealBatchSize(flatLaunchpeg.address, newRevealBatchSize)
      const batchRevealConfig = await batchReveal.launchpegToConfig(flatLaunchpeg.address)
      expect(batchRevealConfig[2]).to.eq(newRevealBatchSize)
    })

    it('Should allow owner to set reveal start time', async () => {
      const invalidRevealStartTime = config.batchRevealStart.add(duration.minutes(8_640_000))
      const newRevealStartTime = config.batchRevealStart.add(duration.minutes(30))
      await initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.Allowlist)
      await expect(
        batchReveal.connect(projectOwner).setRevealStartTime(flatLaunchpeg.address, newRevealStartTime)
      ).to.be.revertedWith('Ownable: caller is not the owner')
      await expect(batchReveal.setRevealStartTime(flatLaunchpeg.address, invalidRevealStartTime)).to.be.revertedWith(
        'Launchpeg__InvalidRevealDates()'
      )
      await batchReveal.setRevealStartTime(flatLaunchpeg.address, newRevealStartTime)
      const batchRevealConfig = await batchReveal.launchpegToConfig(flatLaunchpeg.address)
      expect(batchRevealConfig[3]).to.eq(newRevealStartTime)
    })

    it('Should allow owner to set reveal interval', async () => {
      const invalidRevealInterval = 864_001
      const newRevealInterval = config.batchRevealInterval.add(10)
      await initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.Allowlist)
      await expect(
        batchReveal.connect(projectOwner).setRevealInterval(flatLaunchpeg.address, newRevealInterval)
      ).to.be.revertedWith('Ownable: caller is not the owner')
      await expect(batchReveal.setRevealInterval(flatLaunchpeg.address, invalidRevealInterval)).to.be.revertedWith(
        'Launchpeg__InvalidRevealDates()'
      )
      await batchReveal.setRevealInterval(flatLaunchpeg.address, newRevealInterval)
      const batchRevealConfig = await batchReveal.launchpegToConfig(flatLaunchpeg.address)
      expect(batchRevealConfig[4]).to.eq(newRevealInterval)
    })
  })

  describe('Public sale phase', () => {
    it('The correct amount of NFTs is transfered when the user mints', async () => {
      await initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.PublicSale)

      const quantity = 2
      const price = config.flatPublicSalePrice
      await flatLaunchpeg.connect(bob).publicSaleMint(quantity, { value: price.mul(quantity) })
      expect(await flatLaunchpeg.balanceOf(bob.address)).to.eq(2)
    })

    it('Mint reverts if sale not started', async () => {
      await initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.NotStarted)

      await expect(flatLaunchpeg.connect(alice).publicSaleMint(1)).to.be.revertedWith('Launchpeg__WrongPhase()')
    })

    it('Mint reverts during allowlist phase', async () => {
      await initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.Allowlist)

      await expect(flatLaunchpeg.connect(alice).publicSaleMint(1)).to.be.revertedWith('Launchpeg__WrongPhase()')
    })

    it('Mint reverts when public sale has ended', async () => {
      await initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.Ended)

      await expect(flatLaunchpeg.connect(alice).publicSaleMint(1)).to.be.revertedWith('Launchpeg__WrongPhase()')
    })

    it('Mint reverts when buy size > max allowed', async () => {
      await initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.PublicSale)
      await expect(flatLaunchpeg.connect(alice).publicSaleMint(6)).to.be.revertedWith('Launchpeg__CanNotMintThisMany()')
    })

    it('Mint reverts when not enough AVAX sent', async () => {
      await initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.PublicSale)
      await expect(flatLaunchpeg.connect(alice).publicSaleMint(2)).to.be.revertedWith('Launchpeg__NotEnoughAVAX(0)')
    })

    it('Mint reverts when maxSupply is reached', async () => {
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

      quantity = 6
      await expect(flatLaunchpeg.connect(alice).publicSaleMint(quantity)).to.be.revertedWith(
        'Launchpeg__MaxSupplyReached()'
      )

      quantity = 5
      await flatLaunchpeg.connect(bob).publicSaleMint(quantity, { value: price.mul(quantity) })

      quantity = 1
      await expect(flatLaunchpeg.connect(alice).publicSaleMint(quantity)).to.be.revertedWith('Launchpeg__WrongPhase()')
    })

    it('Mint reverts when address minted maxBatchSize', async () => {
      await initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.PublicSale)

      let quantity = config.maxBatchSize
      const price = config.flatPublicSalePrice
      await flatLaunchpeg.connect(bob).publicSaleMint(quantity, { value: price.mul(quantity) })

      quantity = 1
      await expect(
        flatLaunchpeg.connect(bob).publicSaleMint(quantity, { value: price.mul(quantity) })
      ).to.be.revertedWith('Launchpeg__CanNotMintThisMany()')
    })

    it('Should allow any user to batch mint', async () => {
      await initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.PreMint)
      await flatLaunchpeg.connect(dev).seedAllowlist([alice.address], [5])

      // Alice pre-mints
      const preMintQty = 2
      await flatLaunchpeg.connect(alice).preMint(preMintQty, { value: config.flatAllowlistSalePrice.mul(preMintQty) })
      const blockTimestamp = await latest()
      await advanceTimeAndBlock(duration.seconds(config.publicSaleStartTime.sub(blockTimestamp).toNumber()))
      expect(await flatLaunchpeg.balanceOf(alice.address)).to.eq(0)

      // Bob batch mints
      await flatLaunchpeg.connect(bob).batchMintPreMintedNFTs(1)
      expect(await flatLaunchpeg.balanceOf(alice.address)).to.eq(1)
      expect(await flatLaunchpeg.userAddressToPreMintAmount(alice.address)).to.eq(1)
      // Alice batch mints more than available in queue
      await flatLaunchpeg.connect(alice).batchMintPreMintedNFTs(2)
      expect(await flatLaunchpeg.balanceOf(alice.address)).to.eq(2)
      expect(await flatLaunchpeg.amountBatchMinted()).to.eq(2)
      expect(await flatLaunchpeg.userAddressToPreMintAmount(alice.address)).to.eq(0)

      await expect(flatLaunchpeg.batchMintPreMintedNFTs(5)).to.be.revertedWith(
        'Launchpeg__MaxSupplyForBatchMintReached()'
      )
    })

    it('Should not allow batch mint after public sale', async () => {
      await initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.Ended)
      await expect(flatLaunchpeg.batchMintPreMintedNFTs(5)).to.be.revertedWith('Launchpeg__WrongPhase()')
    })

    it('Owner can set public sale end time', async () => {
      const newPublicSaleEndTime = config.publicSaleEndTime.sub(duration.minutes(30))
      await initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.PublicSale)
      await flatLaunchpeg.setPublicSaleEndTime(newPublicSaleEndTime)
      expect(await flatLaunchpeg.publicSaleEndTime()).to.eq(newPublicSaleEndTime)
    })
  })

  describe('Transfers', () => {
    it('Owner of an NFT should be able to transfer it', async () => {
      await initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.PublicSale)

      const quantity = 2
      const price = config.flatPublicSalePrice
      await flatLaunchpeg.connect(bob).publicSaleMint(quantity, { value: price.mul(quantity) })
      expect(await flatLaunchpeg.ownerOf(1)).to.eq(bob.address)
      await flatLaunchpeg.connect(bob).transferFrom(bob.address, alice.address, 1)
      expect(await flatLaunchpeg.ownerOf(1)).to.eq(alice.address)
    })

    it('Owner of an NFT should be able to give allowance', async () => {
      await initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.PublicSale)

      const quantity = 2
      const price = config.flatPublicSalePrice
      await flatLaunchpeg.connect(bob).publicSaleMint(quantity, { value: price.mul(quantity) })

      await flatLaunchpeg.connect(bob).approve(alice.address, 1)
      await flatLaunchpeg.connect(alice).transferFrom(bob.address, alice.address, 1)
      expect(await flatLaunchpeg.ownerOf(1)).to.eq(alice.address)
    })

    it('TransferFrom with no allowance should fail', async () => {
      await initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.PublicSale)

      const quantity = 2
      const price = config.flatPublicSalePrice
      await flatLaunchpeg.connect(bob).publicSaleMint(quantity, { value: price.mul(quantity) })
      await expect(flatLaunchpeg.connect(alice).transferFrom(bob.address, alice.address, 1)).to.be.revertedWith(
        'TransferCallerNotOwnerNorApproved()'
      )
      expect(await flatLaunchpeg.ownerOf(1)).to.eq(bob.address)
    })
  })

  describe('Funds flow', () => {
    it('Owner can withdraw money', async () => {
      await initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.PublicSale)
      // For some reason the contract has some balance initially, for this particular test only
      const initialContractBalance = await ethers.provider.getBalance(flatLaunchpeg.address)

      await flatLaunchpeg.connect(alice).publicSaleMint(5, { value: config.flatPublicSalePrice.mul(5) })
      await flatLaunchpeg.connect(bob).publicSaleMint(4, { value: config.flatPublicSalePrice.mul(4) })

      const initialDevBalance = await dev.getBalance()

      await flatLaunchpeg.connect(dev).withdrawAVAX(dev.address)
      expect(await dev.getBalance()).to.be.closeTo(
        initialDevBalance.add(config.flatPublicSalePrice.mul(9).add(initialContractBalance)),
        ethers.utils.parseEther('0.01')
      )
    })

    it('Project owner can withdraw money', async () => {
      await initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.PublicSale)
      // For some reason the contract has some balance initially, for this particular test only
      const initialContractBalance = await ethers.provider.getBalance(flatLaunchpeg.address)

      await flatLaunchpeg.connect(alice).publicSaleMint(5, { value: config.flatPublicSalePrice.mul(5) })
      await flatLaunchpeg.connect(bob).publicSaleMint(4, { value: config.flatPublicSalePrice.mul(4) })

      const initialBalance = await projectOwner.getBalance()

      await flatLaunchpeg.connect(projectOwner).withdrawAVAX(projectOwner.address)
      expect(await projectOwner.getBalance()).to.be.closeTo(
        initialBalance.add(config.flatPublicSalePrice.mul(9).add(initialContractBalance)),
        ethers.utils.parseEther('0.01')
      )
    })

    it("Can't withdraw before start time", async () => {
      const blockTimestamp = await latest()
      config.withdrawAVAXStartTime = blockTimestamp.add(duration.days(1))
      await initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.PublicSale)

      await expect(flatLaunchpeg.connect(projectOwner).withdrawAVAX(projectOwner.address)).to.be.revertedWith(
        'Launchpeg__WithdrawAVAXNotAvailable()'
      )
    })

    it("Can't set start time before current block timestamp", async () => {
      const blockTimestamp = await latest()
      await expect(flatLaunchpeg.setWithdrawAVAXStartTime(blockTimestamp.sub(duration.minutes(1)))).to.be.revertedWith(
        'Launchpeg__InvalidStartTime()'
      )
    })

    it("Can't withdraw when start time not initialized", async () => {
      await expect(flatLaunchpeg.connect(projectOwner).withdrawAVAX(projectOwner.address)).to.be.revertedWith(
        'Launchpeg__WithdrawAVAXNotAvailable()'
      )
    })

    it('Fee correctly sent to collector address', async () => {
      await initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.PublicSale)

      const feePercent = 200
      const feeCollector = bob
      await flatLaunchpeg.initializeJoeFee(feePercent, feeCollector.address)

      const total = config.flatPublicSalePrice.mul(5)
      await flatLaunchpeg.connect(alice).publicSaleMint(5, { value: config.flatPublicSalePrice.mul(5) })

      const fee = total.mul(feePercent).div(10000)
      const initialDevBalance = await dev.getBalance()
      const initialFeeCollectorBalance = await feeCollector.getBalance()
      await flatLaunchpeg.connect(dev).withdrawAVAX(dev.address)

      expect(await dev.getBalance()).to.be.closeTo(
        initialDevBalance.add(total.sub(fee)),
        ethers.utils.parseEther('0.01')
      )
      expect(await feeCollector.getBalance()).to.be.eq(initialFeeCollectorBalance.add(fee))
    })
  })

  describe('SafePausable', () => {
    beforeEach(async () => {
      PAUSER_ROLE = await flatLaunchpeg.PAUSER_ROLE()
      UNPAUSER_ROLE = await flatLaunchpeg.UNPAUSER_ROLE()
    })

    it('Should allow owner or pauser to pause mint methods', async () => {
      await flatLaunchpeg.grantRole(PAUSER_ROLE, alice.address)
      await flatLaunchpeg.connect(alice).pause()
      await expect(flatLaunchpeg.connect(dev).devMint(1)).to.be.revertedWith('Pausable: paused')
      await expect(flatLaunchpeg.connect(bob).allowlistMint(1)).to.be.revertedWith('Pausable: paused')
      await expect(flatLaunchpeg.publicSaleMint(1)).to.be.revertedWith('Pausable: paused')

      await flatLaunchpeg.grantRole(UNPAUSER_ROLE, alice.address)
      await flatLaunchpeg.connect(alice).unpause()
      await flatLaunchpeg.connect(dev).devMint(1)
    })

    it('Should allow owner or pauser to pause funds withdrawal', async () => {
      initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.Allowlist)
      await flatLaunchpeg.pause()
      await expect(flatLaunchpeg.connect(projectOwner).withdrawAVAX(alice.address)).to.be.revertedWith(
        'Pausable: paused'
      )

      await flatLaunchpeg.unpause()
      await flatLaunchpeg.connect(projectOwner).withdrawAVAX(alice.address)
    })

    it('Should allow owner or pauser to pause batch reveal', async () => {
      config.collectionSize = 50
      config.amountForDevs = 10
      config.amountForAuction = 0
      config.amountForAllowlist = 0
      config.batchRevealSize = 10
      await deployFlatLaunchpeg()
      initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.Reveal)

      await flatLaunchpeg.devMint(10)
      await flatLaunchpeg.pause()
      await expect(flatLaunchpeg.connect(alice).revealNextBatch()).to.be.revertedWith('Pausable: paused')

      await flatLaunchpeg.unpause()
      await flatLaunchpeg.connect(alice).revealNextBatch()
    })
  })

  after(async () => {
    await network.provider.request({
      method: 'hardhat_reset',
      params: [],
    })
  })
})
