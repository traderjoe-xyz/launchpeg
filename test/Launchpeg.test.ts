import { config as hardhatConfig, ethers, network } from 'hardhat'
import { expect } from 'chai'
import { advanceTimeAndBlock, latest, duration } from './utils/time'
import { initializePhasesLaunchpeg, getDefaultLaunchpegConfig, Phase, LaunchpegConfig } from './utils/helpers'
import { ContractFactory, Contract, BigNumber, Bytes } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

describe('Launchpeg', () => {
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

  let PAUSER_ROLE: Bytes
  let UNPAUSER_ROLE: Bytes

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

  const deployLaunchpeg = async (isBatchRevealEnabled: boolean = true) => {
    if (isBatchRevealEnabled) {
      batchReveal = await batchRevealCF.deploy()
    }
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
    if (isBatchRevealEnabled) {
      await batchReveal.initialize(
        launchpeg.address,
        config.batchRevealSize,
        config.batchRevealStart,
        config.batchRevealInterval
      )
      await launchpeg.setBatchReveal(batchReveal.address)
    }
  }

  const setVRF = async () => {
    await batchReveal.setVRF(coordinatorMock.address, ethers.utils.formatBytes32String('Oxff'), 1, 200_000)
  }

  beforeEach(async () => {
    config = { ...(await getDefaultLaunchpegConfig()) }
    await deployLaunchpeg()
  })

  describe('Initialization', () => {
    it('Amount reserved for devs, auction, allowlist but be lower than collection size', async () => {
      config.collectionSize = config.collectionSize - 1000
      await expect(deployLaunchpeg()).to.be.revertedWith('Launchpeg__LargerCollectionSizeNeeded()')

      config.amountForAllowlist = config.collectionSize
      config.amountForDevs = config.collectionSize
      await expect(deployLaunchpeg()).to.be.revertedWith('Launchpeg__LargerCollectionSizeNeeded()')
    })

    it('Should not allow collection size to be 0', async () => {
      config.collectionSize = 0
      config.batchRevealSize = 0
      await expect(deployLaunchpeg()).to.be.revertedWith('Launchpeg__LargerCollectionSizeNeeded()')
    })

    it('Zero address should not be configurable as project owner', async () => {
      launchpeg = await launchpegCF.deploy()
      await expect(
        launchpeg.initialize(
          'JoePEG',
          'JOEPEG',
          ethers.constants.AddressZero,
          royaltyReceiver.address,
          config.maxBatchSize,
          config.collectionSize,
          config.amountForAuction,
          config.amountForAllowlist,
          config.amountForDevs
        )
      ).to.be.revertedWith('Launchpeg__InvalidProjectOwner()')
    })

    it('Phases can be updated', async () => {
      config.auctionStartTime = (await latest()).add(duration.minutes(5))
      await deployLaunchpeg()
      await initializePhasesLaunchpeg(launchpeg, config, Phase.NotStarted)
      config.auctionStartTime = config.auctionStartTime.add(120)
      await initializePhasesLaunchpeg(launchpeg, config, Phase.NotStarted)
      expect(await launchpeg.allowlistStartTime()).to.be.eq(config.allowlistStartTime)
    })

    it('Phases can be only be initialized by owner', async () => {
      await deployLaunchpeg()
      await expect(
        launchpeg
          .connect(bob)
          .initializePhases(
            config.auctionStartTime,
            config.startPrice,
            config.endPrice,
            config.auctionDropInterval,
            config.preMintStartTime,
            config.allowlistStartTime,
            config.allowlistDiscount,
            config.publicSaleStartTime,
            config.publicSaleEndTime,
            config.publicSaleDiscount
          )
      ).to.be.revertedWith('PendingOwnableUpgradeable__NotOwner()')
    })

    it('MaxBatchSize must be smaller than collection', async () => {
      config.maxBatchSize = config.collectionSize * 2
      await expect(deployLaunchpeg()).to.be.revertedWith('Launchpeg__InvalidMaxBatchSize()')
    })

    it('Auction dates should be correct', async () => {
      config.auctionDropInterval = BigNumber.from(0)
      await expect(initializePhasesLaunchpeg(launchpeg, config, Phase.DutchAuction)).to.be.revertedWith(
        'Launchpeg__InvalidAuctionDropInterval()'
      )

      config.auctionStartTime = BigNumber.from(0)
      await expect(initializePhasesLaunchpeg(launchpeg, config, Phase.DutchAuction)).to.be.revertedWith(
        'Launchpeg__InvalidStartTime()'
      )
    })

    it('AuctionStartPrice must be lower than auctionEndPrice', async () => {
      config.startPrice = ethers.utils.parseEther('1')
      config.endPrice = ethers.utils.parseEther('1.5')
      await expect(initializePhasesLaunchpeg(launchpeg, config, Phase.DutchAuction)).to.be.revertedWith(
        'Launchpeg__EndPriceGreaterThanStartPrice()'
      )
    })

    it('Pre-mint must happen after auction', async () => {
      config.preMintStartTime = config.auctionStartTime.sub(duration.minutes(10))
      await expect(initializePhasesLaunchpeg(launchpeg, config, Phase.DutchAuction)).to.be.revertedWith(
        'Launchpeg__PreMintBeforeAuction()'
      )
    })

    it('Allowlist must happen after pre-mint', async () => {
      config.allowlistStartTime = config.preMintStartTime.sub(duration.minutes(10))
      await expect(initializePhasesLaunchpeg(launchpeg, config, Phase.DutchAuction)).to.be.revertedWith(
        'Launchpeg__AllowlistBeforePreMint()'
      )
    })

    it('Public sale must happen after allowlist', async () => {
      config.publicSaleStartTime = config.auctionStartTime.sub(duration.minutes(20))

      await expect(initializePhasesLaunchpeg(launchpeg, config, Phase.DutchAuction)).to.be.revertedWith(
        'Launchpeg__PublicSaleBeforeAllowlist()'
      )
    })

    it('Public sale end time must be after public sale start time', async () => {
      config.publicSaleEndTime = config.publicSaleStartTime.sub(duration.minutes(60))

      await expect(initializePhasesLaunchpeg(launchpeg, config, Phase.DutchAuction)).to.be.revertedWith(
        'Launchpeg__PublicSaleEndBeforePublicSaleStart()'
      )
    })

    it('Public sale and allowlist discount must be < 100%', async () => {
      config.allowlistDiscount = 10_001

      await expect(initializePhasesLaunchpeg(launchpeg, config, Phase.DutchAuction)).to.be.revertedWith(
        'Launchpeg__InvalidPercent()'
      )
    })

    it('Batch reveal dates must be coherent', async () => {
      batchReveal = await batchRevealCF.deploy()

      await expect(
        batchReveal.initialize(
          launchpeg.address,
          config.batchRevealSize,
          config.batchRevealStart.add(8_640_000),
          config.batchRevealInterval
        )
      ).to.be.revertedWith('Launchpeg__InvalidRevealDates()')

      await expect(
        batchReveal.initialize(
          launchpeg.address,
          config.batchRevealSize,
          config.batchRevealStart,
          config.batchRevealInterval.add(864_000)
        )
      ).to.be.revertedWith('Launchpeg__InvalidRevealDates()')
    })

    it('Should not allow batch reveal config to be set prior to batch reveal initialization', async () => {
      batchReveal = await batchRevealCF.deploy()
      await expect(batchReveal.setRevealBatchSize(config.batchRevealSize)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )
      await expect(batchReveal.setRevealStartTime(config.batchRevealStart)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )
      await expect(batchReveal.setRevealInterval(config.batchRevealInterval)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )
    })

    it('Should not allow 0 batch reveal size', async () => {
      config.batchRevealSize = 0
      await expect(deployLaunchpeg()).to.be.revertedWith('Launchpeg__InvalidBatchRevealSize()')
    })

    it('Should not allow invalid reveal batch size', async () => {
      config.batchRevealSize = config.batchRevealSize + 1
      await expect(deployLaunchpeg()).to.be.revertedWith('Launchpeg__InvalidBatchRevealSize()')
    })

    it('Should not allow invalid reveal start time', async () => {
      config.batchRevealStart = config.batchRevealStart.add(8_640_000)
      await expect(deployLaunchpeg()).to.be.revertedWith('Launchpeg__InvalidRevealDates()')
    })

    it('Should not allow invalid reveal interval', async () => {
      config.batchRevealInterval = config.batchRevealInterval.add(864_000)
      await expect(deployLaunchpeg()).to.be.revertedWith('Launchpeg__InvalidRevealDates()')
    })

    it('Reverts when setting auction sale start time before phases are initialized', async () => {
      const newAuctionSaleStartTime = config.auctionStartTime.sub(duration.minutes(30))
      await expect(launchpeg.setAuctionSaleStartTime(newAuctionSaleStartTime)).to.be.revertedWith(
        'Launchpeg__NotInitialized()'
      )
    })

    it('Reverts when setting pre-mint start time before phases are initialized', async () => {
      const newPreMintStartTime = config.preMintStartTime.sub(duration.minutes(30))
      await expect(launchpeg.setPreMintStartTime(newPreMintStartTime)).to.be.revertedWith('Launchpeg__NotInitialized()')
    })

    it('Reverts when setting allowlist start time before phases are initialized', async () => {
      const newAllowlistStartTime = config.allowlistStartTime.sub(duration.minutes(30))
      await expect(launchpeg.setAllowlistStartTime(newAllowlistStartTime)).to.be.revertedWith(
        'Launchpeg__NotInitialized()'
      )
    })

    it('Reverts when setting public sale start time before phases are initialized', async () => {
      const newPublicSaleStartTime = config.publicSaleStartTime.sub(duration.minutes(30))
      await expect(launchpeg.setPublicSaleStartTime(newPublicSaleStartTime)).to.be.revertedWith(
        'Launchpeg__NotInitialized()'
      )
    })

    it('Reverts when setting public sale end time before phases are initialized', async () => {
      const newPublicSaleEndTime = config.publicSaleEndTime.sub(duration.minutes(30))
      await expect(launchpeg.setPublicSaleEndTime(newPublicSaleEndTime)).to.be.revertedWith(
        'Launchpeg__NotInitialized()'
      )
    })
  })

  describe('Dutch auction phase', () => {
    it('NFT price decreases at correct pace', async () => {
      // Start auction
      const saleStartTime = config.auctionStartTime
      await initializePhasesLaunchpeg(launchpeg, config, Phase.DutchAuction)

      // Verify start price
      var auctionPrice = await launchpeg.getAuctionPrice(saleStartTime)
      expect(auctionPrice).to.be.eq(config.startPrice)

      // 50 minutes later
      await advanceTimeAndBlock(duration.minutes(50))

      // Verify discounted price
      auctionPrice = await launchpeg.getAuctionPrice(saleStartTime)
      expect(auctionPrice).to.be.eq(ethers.utils.parseEther('0.66'))

      // 50 minutes later
      await advanceTimeAndBlock(duration.minutes(50))

      // Verify floor price
      auctionPrice = await launchpeg.getAuctionPrice(saleStartTime)
      const floorPrice = ethers.utils.parseEther('0.15')
      expect(auctionPrice).to.be.eq(floorPrice)
    })

    it('Mint reverts when sale start date not set', async () => {
      await expect(launchpeg.auctionMint(1)).to.be.revertedWith('Launchpeg__WrongPhase()')
    })

    it('Mint reverts when sale has not started yet', async () => {
      await initializePhasesLaunchpeg(launchpeg, config, Phase.NotStarted)

      await expect(launchpeg.auctionMint(1)).to.be.revertedWith('Launchpeg__WrongPhase()')
    })

    it('Mint reverts when sale is over', async () => {
      await initializePhasesLaunchpeg(launchpeg, config, Phase.Allowlist)

      await expect(launchpeg.auctionMint(1)).to.be.revertedWith('Launchpeg__WrongPhase()')
    })

    it('NFT are transfered to sender when user has enough AVAX', async () => {
      await initializePhasesLaunchpeg(launchpeg, config, Phase.DutchAuction)

      expect(await launchpeg.balanceOf(alice.address)).to.eq(0)
      await launchpeg
        .connect(alice)
        .auctionMint(config.maxBatchSize, { value: config.startPrice.mul(config.maxBatchSize) })
      expect(await launchpeg.balanceOf(alice.address)).to.eq(config.maxBatchSize)
    })

    it('Ownership data is correct', async () => {
      await initializePhasesLaunchpeg(launchpeg, config, Phase.DutchAuction)

      await launchpeg
        .connect(alice)
        .auctionMint(config.maxBatchSize, { value: config.startPrice.mul(config.maxBatchSize) })

      let ownershipData = await launchpeg.getOwnershipData(1)

      expect(ownershipData[0]).to.eq(alice.address)
      expect(ownershipData[2]).to.eq(false)
    })

    it('Refund caller when too much AVAX sent', async () => {
      await initializePhasesLaunchpeg(launchpeg, config, Phase.DutchAuction)

      const quantity = 2
      const aliceInitialBalance = await alice.getBalance()

      await launchpeg.connect(alice).auctionMint(quantity, { value: config.startPrice.mul(quantity + 1) })
      expect(await launchpeg.balanceOf(alice.address)).to.eq(quantity)
      expect(await alice.getBalance()).to.be.closeTo(
        aliceInitialBalance.sub(config.startPrice.mul(quantity)),
        ethers.utils.parseEther('0.01')
      )
    })

    it('NFTs sold out during auction', async () => {
      config.collectionSize = 15
      config.amountForAuction = 5
      config.amountForAllowlist = 5
      config.amountForDevs = 5
      config.batchRevealSize = 5
      await deployLaunchpeg()
      await initializePhasesLaunchpeg(launchpeg, config, Phase.DutchAuction)

      await launchpeg.connect(projectOwner).devMint(5)
      await launchpeg.connect(alice).auctionMint(5, { value: config.startPrice.mul(5) })
      await expect(launchpeg.connect(bob).auctionMint(5, { value: config.startPrice.mul(5) })).to.be.revertedWith(
        'Launchpeg__MaxSupplyReached()'
      )
    })

    it('Can buy when desired quantity is greater than remaining supply', async () => {
      config.collectionSize = 15
      config.amountForAuction = 5
      config.amountForAllowlist = 5
      config.amountForDevs = 5
      config.batchRevealSize = 5
      await deployLaunchpeg()
      await initializePhasesLaunchpeg(launchpeg, config, Phase.DutchAuction)

      await launchpeg.connect(alice).auctionMint(4, { value: config.startPrice.mul(5) })
      await launchpeg.connect(projectOwner).devMint(5)
      await launchpeg.connect(bob).auctionMint(5, { value: config.startPrice.mul(5) })
      expect(await launchpeg.balanceOf(alice.address)).to.eq(4)
      expect(await launchpeg.balanceOf(bob.address)).to.eq(1)
    })

    it('Owner can set auction sale start time', async () => {
      let invalidAuctionSaleStartTime = BigNumber.from(0)
      const newAuctionSaleStartTime = config.auctionStartTime.add(duration.minutes(30))
      await initializePhasesLaunchpeg(launchpeg, config, Phase.DutchAuction)
      await expect(launchpeg.connect(projectOwner).setAuctionSaleStartTime(newAuctionSaleStartTime)).to.be.revertedWith(
        'PendingOwnableUpgradeable__NotOwner()'
      )
      await expect(launchpeg.setAuctionSaleStartTime(invalidAuctionSaleStartTime)).to.be.revertedWith(
        'Launchpeg__InvalidStartTime()'
      )
      invalidAuctionSaleStartTime = config.allowlistStartTime.add(duration.minutes(30))
      await expect(launchpeg.setAuctionSaleStartTime(invalidAuctionSaleStartTime)).to.be.revertedWith(
        'Launchpeg__PreMintBeforeAuction()'
      )
      await launchpeg.setAuctionSaleStartTime(newAuctionSaleStartTime)
      expect(await launchpeg.auctionSaleStartTime()).to.eq(newAuctionSaleStartTime)
    })

    it('Owner can set pre-mint start time', async () => {
      let invalidPreMintStartTime = config.auctionStartTime.sub(duration.minutes(30))
      const newPreMintStartTime = config.preMintStartTime.sub(duration.minutes(30))
      await initializePhasesLaunchpeg(launchpeg, config, Phase.PreMint)
      await expect(launchpeg.connect(projectOwner).setPreMintStartTime(newPreMintStartTime)).to.be.revertedWith(
        'PendingOwnableUpgradeable__NotOwner()'
      )
      await expect(launchpeg.setPreMintStartTime(invalidPreMintStartTime)).to.be.revertedWith(
        'Launchpeg__PreMintBeforeAuction()'
      )
      invalidPreMintStartTime = config.allowlistStartTime.add(duration.minutes(30))
      await expect(launchpeg.setPreMintStartTime(invalidPreMintStartTime)).to.be.revertedWith(
        'Launchpeg__AllowlistBeforePreMint()'
      )
      await launchpeg.setPreMintStartTime(newPreMintStartTime)
      expect(await launchpeg.preMintStartTime()).to.eq(newPreMintStartTime)
    })

    it('Owner can set allowlist start time', async () => {
      let invalidAllowlistStartTime = config.preMintStartTime.sub(duration.minutes(30))
      const newAllowlistStartTime = config.allowlistStartTime.sub(duration.minutes(30))
      await initializePhasesLaunchpeg(launchpeg, config, Phase.DutchAuction)
      await expect(launchpeg.connect(projectOwner).setAllowlistStartTime(newAllowlistStartTime)).to.be.revertedWith(
        'PendingOwnableUpgradeable__NotOwner()'
      )
      await expect(launchpeg.setAllowlistStartTime(invalidAllowlistStartTime)).to.be.revertedWith(
        'Launchpeg__AllowlistBeforePreMint()'
      )
      invalidAllowlistStartTime = config.publicSaleStartTime.add(duration.minutes(30))
      await expect(launchpeg.setAllowlistStartTime(invalidAllowlistStartTime)).to.be.revertedWith(
        'Launchpeg__PublicSaleBeforeAllowlist()'
      )
      await launchpeg.setAllowlistStartTime(newAllowlistStartTime)
      expect(await launchpeg.allowlistStartTime()).to.eq(newAllowlistStartTime)
    })

    it('Owner can set public sale start time', async () => {
      let invalidPublicSaleStartTime = config.allowlistStartTime.sub(duration.minutes(30))
      const newPublicSaleStartTime = config.publicSaleStartTime.sub(duration.minutes(30))
      await initializePhasesLaunchpeg(launchpeg, config, Phase.DutchAuction)
      await expect(launchpeg.connect(projectOwner).setPublicSaleStartTime(newPublicSaleStartTime)).to.be.revertedWith(
        'PendingOwnableUpgradeable__NotOwner()'
      )
      await expect(launchpeg.setPublicSaleStartTime(invalidPublicSaleStartTime)).to.be.revertedWith(
        'Launchpeg__PublicSaleBeforeAllowlist()'
      )
      invalidPublicSaleStartTime = config.publicSaleEndTime.add(duration.minutes(30))
      await expect(launchpeg.setPublicSaleStartTime(invalidPublicSaleStartTime)).to.be.revertedWith(
        'Launchpeg__PublicSaleEndBeforePublicSaleStart()'
      )
      await launchpeg.setPublicSaleStartTime(newPublicSaleStartTime)
      expect(await launchpeg.publicSaleStartTime()).to.eq(newPublicSaleStartTime)
    })

    it('Owner can set public sale end time', async () => {
      const invalidPublicSaleEndTime = config.publicSaleStartTime.sub(duration.minutes(30))
      const newPublicSaleEndTime = config.publicSaleEndTime.sub(duration.minutes(30))
      await initializePhasesLaunchpeg(launchpeg, config, Phase.DutchAuction)
      await expect(launchpeg.connect(projectOwner).setPublicSaleEndTime(newPublicSaleEndTime)).to.be.revertedWith(
        'PendingOwnableUpgradeable__NotOwner()'
      )
      await expect(launchpeg.setPublicSaleEndTime(invalidPublicSaleEndTime)).to.be.revertedWith(
        'Launchpeg__PublicSaleEndBeforePublicSaleStart()'
      )
      await launchpeg.setPublicSaleEndTime(newPublicSaleEndTime)
      expect(await launchpeg.publicSaleEndTime()).to.eq(newPublicSaleEndTime)
    })

    it('Should allow owner to set reveal batch size', async () => {
      const invalidRevealBatchSize = 101
      const newRevealBatchSize = 100
      await initializePhasesLaunchpeg(launchpeg, config, Phase.DutchAuction)
      await expect(batchReveal.connect(projectOwner).setRevealBatchSize(newRevealBatchSize)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )
      await expect(batchReveal.setRevealBatchSize(invalidRevealBatchSize)).to.be.revertedWith(
        'Launchpeg__InvalidBatchRevealSize()'
      )
      await batchReveal.setRevealBatchSize(newRevealBatchSize)
      expect(await batchReveal.revealBatchSize()).to.eq(newRevealBatchSize)
    })

    it('Should allow owner to set reveal start time', async () => {
      const invalidRevealStartTime = config.batchRevealStart.add(duration.minutes(8_640_000))
      const newRevealStartTime = config.batchRevealStart.add(duration.minutes(30))
      await initializePhasesLaunchpeg(launchpeg, config, Phase.DutchAuction)
      await expect(batchReveal.connect(projectOwner).setRevealStartTime(newRevealStartTime)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )
      await expect(batchReveal.setRevealStartTime(invalidRevealStartTime)).to.be.revertedWith(
        'Launchpeg__InvalidRevealDates()'
      )
      await batchReveal.setRevealStartTime(newRevealStartTime)
      expect(await batchReveal.revealStartTime()).to.eq(newRevealStartTime)
    })

    it('Should allow owner to set reveal interval', async () => {
      const invalidRevealInterval = 864_001
      const newRevealInterval = config.batchRevealInterval.add(10)
      await initializePhasesLaunchpeg(launchpeg, config, Phase.DutchAuction)
      await expect(batchReveal.connect(projectOwner).setRevealInterval(newRevealInterval)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )
      await expect(batchReveal.setRevealInterval(invalidRevealInterval)).to.be.revertedWith(
        'Launchpeg__InvalidRevealDates()'
      )
      await batchReveal.setRevealInterval(newRevealInterval)
      expect(await batchReveal.revealInterval()).to.eq(newRevealInterval)
    })
  })

  describe('Pre-mint phase', () => {
    // TODO
  })

  describe('Allowlist phase', () => {
    it('NFT is transfered when user is on allowlist', async () => {
      await initializePhasesLaunchpeg(launchpeg, config, Phase.Allowlist)

      await launchpeg.seedAllowlist([bob.address], [5])
      const discount = config.startPrice.mul(config.allowlistDiscount).div(10000)
      await launchpeg.connect(bob).allowlistMint(5, { value: config.startPrice.sub(discount).mul(5) })
      expect(await launchpeg.balanceOf(bob.address)).to.eq(5)
      expect(await launchpeg.amountMintedDuringAllowlist()).to.eq(5)
    })

    it('Mint reverts when user tries to mint more NFTs than allowed', async () => {
      await initializePhasesLaunchpeg(launchpeg, config, Phase.Allowlist)

      const discount = config.startPrice.mul(config.allowlistDiscount).div(10000)
      const price = config.startPrice.sub(discount)

      await launchpeg.seedAllowlist([bob.address], [4])
      await launchpeg.connect(bob).allowlistMint(2, { value: price.mul(3) }) // intentionally sending more AVAX to test refund
      await launchpeg.connect(bob).allowlistMint(1, { value: price })

      await expect(launchpeg.connect(bob).allowlistMint(2, { value: price.mul(2) })).to.be.revertedWith(
        'Launchpeg__NotEligibleForAllowlistMint()'
      )
      expect(await launchpeg.balanceOf(bob.address)).to.eq(3)
    })

    it('Mint reverts when not started yet', async () => {
      await initializePhasesLaunchpeg(launchpeg, config, Phase.DutchAuction)

      await expect(launchpeg.connect(bob).allowlistMint(1)).to.be.revertedWith('Launchpeg__WrongPhase()')
    })

    it('Mint reverts when the caller is not on allowlist during mint phase', async () => {
      await initializePhasesLaunchpeg(launchpeg, config, Phase.Allowlist)

      await expect(launchpeg.connect(bob).allowlistMint(1)).to.be.revertedWith(
        'Launchpeg__NotEligibleForAllowlistMint()'
      )
    })

    it("Mint reverts when the caller didn't send enough AVAX", async () => {
      await initializePhasesLaunchpeg(launchpeg, config, Phase.Allowlist)

      await launchpeg.seedAllowlist([alice.address], [1])
      await expect(launchpeg.connect(alice).allowlistMint(1)).to.be.revertedWith('Launchpeg__NotEnoughAVAX(0)')
    })

    it('Mint reverts during public sale', async () => {
      await initializePhasesLaunchpeg(launchpeg, config, Phase.PublicSale)

      await launchpeg.seedAllowlist([alice.address], [1])
      await expect(launchpeg.connect(alice).allowlistMint(1)).to.be.revertedWith('Launchpeg__WrongPhase')
    })

    it('Seed allowlist reverts when addresses does not match numSlots length', async () => {
      await expect(launchpeg.seedAllowlist([alice.address, bob.address], [1])).to.be.revertedWith(
        'Launchpeg__WrongAddressesAndNumSlotsLength()'
      )
    })

    it('Mint price is discounted', async () => {
      await initializePhasesLaunchpeg(launchpeg, config, Phase.Allowlist)
      expect(await launchpeg.allowlistPrice()).to.eq(ethers.utils.parseUnits('0.9', 18))
    })

    it('Owner can set public sale start time', async () => {
      const newPublicSaleStartTime = config.publicSaleStartTime.sub(duration.minutes(30))
      await initializePhasesLaunchpeg(launchpeg, config, Phase.Allowlist)
      await launchpeg.setPublicSaleStartTime(newPublicSaleStartTime)
      expect(await launchpeg.publicSaleStartTime()).to.eq(newPublicSaleStartTime)
    })

    it('Owner can set public sale end time', async () => {
      const newPublicSaleEndTime = config.publicSaleEndTime.sub(duration.minutes(30))
      await initializePhasesLaunchpeg(launchpeg, config, Phase.Allowlist)
      await launchpeg.setPublicSaleEndTime(newPublicSaleEndTime)
      expect(await launchpeg.publicSaleEndTime()).to.eq(newPublicSaleEndTime)
    })
  })

  describe('Public sale phase', () => {
    it('The correct amount of NFTs is transfered when the user mints', async () => {
      await initializePhasesLaunchpeg(launchpeg, config, Phase.PublicSale)

      const quantity = 2
      const discount = config.startPrice.mul(config.publicSaleDiscount).div(10000)
      const price = config.startPrice.sub(discount)
      await launchpeg.connect(bob).publicSaleMint(quantity, { value: price.mul(quantity) })
      expect(await launchpeg.balanceOf(bob.address)).to.eq(2)
      expect(await launchpeg.amountMintedDuringPublicSale()).to.eq(2)
    })

    it('Mint reverts during dutch auction', async () => {
      await initializePhasesLaunchpeg(launchpeg, config, Phase.DutchAuction)

      await expect(launchpeg.connect(alice).publicSaleMint(1)).to.be.revertedWith('Launchpeg__WrongPhase()')
    })

    it('Mint reverts during allowlist phase', async () => {
      await initializePhasesLaunchpeg(launchpeg, config, Phase.Allowlist)

      await expect(launchpeg.connect(alice).publicSaleMint(1)).to.be.revertedWith('Launchpeg__WrongPhase()')
    })

    it('Mint reverts when public sale has ended', async () => {
      await initializePhasesLaunchpeg(launchpeg, config, Phase.Ended)

      await expect(launchpeg.connect(alice).publicSaleMint(1)).to.be.revertedWith('Launchpeg__WrongPhase()')
    })

    it('Mint reverts when buy size > max allowed', async () => {
      await initializePhasesLaunchpeg(launchpeg, config, Phase.PublicSale)

      await expect(launchpeg.connect(alice).publicSaleMint(6)).to.be.revertedWith('Launchpeg__CanNotMintThisMany()')
    })

    it('Mint reverts when not enough AVAX sent', async () => {
      await initializePhasesLaunchpeg(launchpeg, config, Phase.PublicSale)

      await expect(launchpeg.connect(alice).publicSaleMint(2)).to.be.revertedWith('Launchpeg__NotEnoughAVAX(0)')
    })

    it('Mint reverts when maxSupply is reached', async () => {
      config.collectionSize = 10
      config.amountForAuction = 0
      config.amountForDevs = 0
      config.amountForAllowlist = 0
      config.maxBatchSize = 10
      config.batchRevealSize = 10
      await deployLaunchpeg()
      await initializePhasesLaunchpeg(launchpeg, config, Phase.PublicSale)

      let quantity = 5
      const price = config.flatPublicSalePrice
      await launchpeg.connect(bob).publicSaleMint(quantity, { value: price.mul(quantity) })

      quantity = 6
      await expect(launchpeg.connect(alice).publicSaleMint(quantity)).to.be.revertedWith(
        'Launchpeg__MaxSupplyReached()'
      )

      quantity = 5
      await launchpeg.connect(bob).publicSaleMint(quantity, { value: price.mul(quantity) })

      quantity = 1
      await expect(launchpeg.connect(alice).publicSaleMint(quantity)).to.be.revertedWith('Launchpeg__WrongPhase()')
    })

    it('Mint reverts when the user already minted max amount', async () => {
      await initializePhasesLaunchpeg(launchpeg, config, Phase.PublicSale)

      const discount = config.startPrice.mul(config.publicSaleDiscount).div(10000)
      const price = config.startPrice.sub(discount)
      const value = price.mul(5)
      await launchpeg.connect(alice).publicSaleMint(5, { value })
      await expect(launchpeg.connect(alice).publicSaleMint(5, { value })).to.be.revertedWith(
        'Launchpeg__CanNotMintThisMany()'
      )
      expect(await launchpeg.balanceOf(alice.address)).to.eq(5)
    })

    it('User can only mint up to maxPerAddressDuringMint', async () => {
      // start auction
      await initializePhasesLaunchpeg(launchpeg, config, Phase.DutchAuction)

      // mint 4 during auction
      await launchpeg.connect(alice).auctionMint(4, { value: config.startPrice.mul(4) })

      // mint 2 during public sale should revert
      await advanceTimeAndBlock(duration.minutes(200))
      await expect(launchpeg.connect(alice).publicSaleMint(2, { value: config.startPrice.mul(2) })).to.be.revertedWith(
        'Launchpeg__CanNotMintThisMany()'
      )
    })

    it('Public sale price is discounted', async () => {
      await initializePhasesLaunchpeg(launchpeg, config, Phase.PublicSale)
      expect(await launchpeg.salePrice()).to.eq(ethers.utils.parseUnits('0.8', 18))
    })

    it('Public sale is limited by amount for dev', async () => {
      config.collectionSize = 10
      config.amountForAuction = 5
      config.amountForAllowlist = 0
      config.amountForDevs = 5
      config.batchRevealSize = 5
      await deployLaunchpeg()
      await initializePhasesLaunchpeg(launchpeg, config, Phase.PublicSale)

      await launchpeg.connect(alice).publicSaleMint(5, { value: config.startPrice.mul(5) })
      await expect(launchpeg.connect(alice).publicSaleMint(5, { value: config.startPrice.mul(5) })).to.be.revertedWith(
        'Launchpeg__MaxSupplyReached()'
      )
    })

    it('Owner can set public sale end time', async () => {
      const newPublicSaleEndTime = config.publicSaleEndTime.sub(duration.minutes(30))
      await initializePhasesLaunchpeg(launchpeg, config, Phase.PublicSale)
      await launchpeg.setPublicSaleEndTime(newPublicSaleEndTime)
      expect(await launchpeg.publicSaleEndTime()).to.eq(newPublicSaleEndTime)
    })
  })

  describe('Project owner mint', () => {
    it('Mint up to max limit', async () => {
      // mint amount that is not a multiple of max batch size
      await launchpeg.connect(projectOwner).devMint(config.maxBatchSize)
      await launchpeg.connect(projectOwner).devMint(config.amountForDevs - config.maxBatchSize - 1)
      await launchpeg.connect(projectOwner).devMint(1)
      await expect(launchpeg.connect(projectOwner).devMint(1)).to.be.revertedWith('Launchpeg__MaxSupplyForDevReached()')
      expect(await launchpeg.balanceOf(projectOwner.address)).to.eq(config.amountForDevs)
    })

    it('Devs cannot mint more than maxSupply', async () => {
      config.collectionSize = 50
      config.amountForDevs = 50
      config.amountForAuction = 0
      config.amountForAllowlist = 0
      config.batchRevealSize = 10
      await deployLaunchpeg()
      await initializePhasesLaunchpeg(launchpeg, config, Phase.DutchAuction)

      await launchpeg.connect(projectOwner).devMint(config.amountForDevs)
      await expect(launchpeg.connect(projectOwner).devMint(1)).to.be.revertedWith('Launchpeg__MaxSupplyReached()')
    })

    it('Only dev can mint', async () => {
      await expect(launchpeg.connect(alice).devMint(1)).to.be.revertedWith(
        'SafeAccessControlEnumerableUpgradeable__SenderMissingRoleAndIsNotOwner'
      )
    })

    it('Mint after project owner changes', async () => {
      await launchpeg.connect(dev).grantRole(launchpeg.PROJECT_OWNER_ROLE(), alice.address)
      await launchpeg.connect(alice).devMint(config.amountForDevs)
      expect(await launchpeg.balanceOf(alice.address)).to.eq(config.amountForDevs)
    })
  })

  describe('Funds flow', () => {
    it('Owner can withdraw money', async () => {
      await initializePhasesLaunchpeg(launchpeg, config, Phase.DutchAuction)

      await launchpeg.connect(alice).auctionMint(5, { value: config.startPrice.mul(5) })
      await launchpeg.connect(bob).auctionMint(4, { value: config.startPrice.mul(4) })

      const initialDevBalance = await dev.getBalance()
      await launchpeg.connect(dev).withdrawAVAX(dev.address)
      expect(await dev.getBalance()).to.be.closeTo(
        initialDevBalance.add(config.startPrice.mul(9)),
        ethers.utils.parseEther('0.01')
      )
    })

    it('Project owner can withdraw money', async () => {
      await initializePhasesLaunchpeg(launchpeg, config, Phase.DutchAuction)

      await launchpeg.connect(alice).auctionMint(5, { value: config.startPrice.mul(5) })
      await launchpeg.connect(bob).auctionMint(4, { value: config.startPrice.mul(4) })

      const initialBalance = await projectOwner.getBalance()
      await launchpeg.connect(projectOwner).withdrawAVAX(projectOwner.address)
      expect(await projectOwner.getBalance()).to.be.closeTo(
        initialBalance.add(config.startPrice.mul(9)),
        ethers.utils.parseEther('0.01')
      )
    })

    it("Can't withdraw before start time", async () => {
      await initializePhasesLaunchpeg(launchpeg, config, Phase.DutchAuction)

      const blockTimestamp = await latest()
      await launchpeg.setWithdrawAVAXStartTime(blockTimestamp.add(duration.hours(1)))

      await expect(launchpeg.connect(projectOwner).withdrawAVAX(projectOwner.address)).to.be.revertedWith(
        'Launchpeg__WithdrawAVAXNotAvailable()'
      )
    })

    it("Can't set start time before current block timestamp", async () => {
      const blockTimestamp = await latest()
      await expect(launchpeg.setWithdrawAVAXStartTime(blockTimestamp.sub(duration.minutes(1)))).to.be.revertedWith(
        'Launchpeg__InvalidStartTime()'
      )
    })

    it("Can't withdraw when start time not initialized", async () => {
      await expect(launchpeg.connect(projectOwner).withdrawAVAX(projectOwner.address)).to.be.revertedWith(
        'Launchpeg__WithdrawAVAXNotAvailable()'
      )
    })

    it('Invalid fee setup should be blocked', async () => {
      let feePercent = 10001
      let feeCollector = bob
      await expect(launchpeg.initializeJoeFee(feePercent, feeCollector.address)).to.be.revertedWith(
        'Launchpeg__InvalidPercent()'
      )

      feePercent = 100
      await expect(launchpeg.initializeJoeFee(feePercent, ethers.constants.AddressZero)).to.be.revertedWith(
        'Launchpeg__InvalidJoeFeeCollector()'
      )
    })

    it('initializeJoeFee() should be callable only once', async () => {
      let feePercent = 200
      let feeCollector = bob

      await launchpeg.initializeJoeFee(feePercent, feeCollector.address)

      await expect(launchpeg.initializeJoeFee(feePercent, feeCollector.address)).to.be.revertedWith(
        'Launchpeg__JoeFeeAlreadyInitialized()'
      )
    })

    it('Fee correctly sent to collector address', async () => {
      const feePercent = 200
      const feeCollector = bob
      await launchpeg.initializeJoeFee(feePercent, feeCollector.address)
      await initializePhasesLaunchpeg(launchpeg, config, Phase.DutchAuction)

      const total = config.startPrice.mul(5)
      await launchpeg.connect(alice).auctionMint(5, { value: total })

      const fee = total.mul(feePercent).div(10000)
      const initialDevBalance = await dev.getBalance()
      const initialFeeCollectorBalance = await feeCollector.getBalance()
      await launchpeg.connect(dev).withdrawAVAX(dev.address)
      expect(await dev.getBalance()).to.be.closeTo(
        initialDevBalance.add(total.sub(fee)),
        ethers.utils.parseEther('0.01')
      )
      expect(await feeCollector.getBalance()).to.be.eq(initialFeeCollectorBalance.add(fee))
    })

    it('Royalty fees should be correctly set up', async () => {
      let royaltyPercent = 500
      let royaltyCollector = bob
      await launchpeg.setRoyaltyInfo(royaltyCollector.address, royaltyPercent)

      let price = ethers.utils.parseEther('1')
      expect((await launchpeg.royaltyInfo(1, price))[1]).to.eq(price.mul(royaltyPercent).div(10_000))

      await expect(launchpeg.setRoyaltyInfo(royaltyCollector.address, 3_000)).to.be.revertedWith(
        'Launchpeg__InvalidRoyaltyInfo()'
      )
    })
  })

  describe('Batch reveal on mint', () => {
    it('NFTs should be unrevealed initially', async () => {
      await initializePhasesLaunchpeg(launchpeg, config, Phase.DutchAuction)
      expect(await launchpeg.tokenURI(0)).to.be.equal(config.unrevealedTokenURI)
    })

    it('Should reveal NFTs immediately if batch reveal is disabled', async () => {
      const isBatchRevealEnabled = false
      const tokenId = 0
      const expTokenURI = `${config.baseTokenURI}${tokenId}`
      config.batchRevealSize = 0
      await deployLaunchpeg(isBatchRevealEnabled)
      await launchpeg.setBaseURI(config.baseTokenURI)
      expect(await launchpeg.tokenURI(tokenId)).to.be.equal(expTokenURI)
    })

    it('First NFTs should be revealed gradually', async () => {
      config.collectionSize = 50
      config.amountForDevs = 50
      config.amountForAuction = 0
      config.amountForAllowlist = 0
      config.batchRevealSize = 10
      config.batchRevealStart = BigNumber.from(0)
      config.batchRevealInterval = BigNumber.from(0)
      await deployLaunchpeg()
      await initializePhasesLaunchpeg(launchpeg, config, Phase.DutchAuction)

      await launchpeg.connect(projectOwner).devMint(config.batchRevealSize)
      expect((await launchpeg.hasBatchToReveal())[0]).to.eq(true)
      await launchpeg.connect(alice).revealNextBatch()
      expect((await launchpeg.hasBatchToReveal())[0]).to.eq(false)

      expect(await launchpeg.tokenURI(0)).to.contains(config.baseTokenURI)
      expect(await launchpeg.tokenURI(config.batchRevealSize)).to.be.equal(config.unrevealedTokenURI)

      await launchpeg.connect(projectOwner).devMint(config.batchRevealSize)

      expect((await launchpeg.hasBatchToReveal())[1]).to.eq(BigNumber.from(1))
      await launchpeg.connect(bob).revealNextBatch()
      expect(await launchpeg.tokenURI(2 * config.batchRevealSize - 1)).to.contains(config.baseTokenURI)
      expect(await launchpeg.tokenURI(2 * config.batchRevealSize + 1)).to.be.equal(config.unrevealedTokenURI)

      // Minting the rest of the collection
      for (let i = 0; i < 3; i++) {
        await launchpeg.connect(projectOwner).devMint(config.batchRevealSize)
        await launchpeg.connect(bob).revealNextBatch()
      }
      expect(await launchpeg.tokenURI(config.collectionSize - 1)).to.contains(config.baseTokenURI)
    })

    it('RevealNextBatch should not be available too early', async () => {
      config.collectionSize = 50
      config.amountForDevs = 50
      config.amountForAuction = 0
      config.amountForAllowlist = 0
      config.batchRevealSize = 10
      config.batchRevealStart = BigNumber.from(0)
      config.batchRevealInterval = BigNumber.from(0)
      await deployLaunchpeg()

      await initializePhasesLaunchpeg(launchpeg, config, Phase.DutchAuction)

      await expect(launchpeg.connect(alice).revealNextBatch()).to.be.revertedWith(
        'Launchpeg__RevealNextBatchNotAvailable'
      )

      await launchpeg.connect(projectOwner).devMint(config.batchRevealSize)
      await launchpeg.connect(bob).revealNextBatch()
      await expect(launchpeg.connect(alice).revealNextBatch()).to.be.revertedWith(
        'Launchpeg__RevealNextBatchNotAvailable'
      )
    })
  })

  describe('Batch reveal event after sale', () => {
    it('First NFTs should not be revealed during sale', async () => {
      config.collectionSize = 50
      config.amountForDevs = 50
      config.amountForAuction = 0
      config.amountForAllowlist = 0
      config.batchRevealSize = 10
      await deployLaunchpeg()
      await initializePhasesLaunchpeg(launchpeg, config, Phase.DutchAuction)

      await launchpeg.connect(projectOwner).devMint(config.batchRevealSize)

      expect(await launchpeg.tokenURI(0)).to.be.equal(config.unrevealedTokenURI)
      await expect(launchpeg.connect(alice).revealNextBatch()).to.be.revertedWith(
        'Launchpeg__RevealNextBatchNotAvailable'
      )

      await launchpeg.connect(projectOwner).devMint(config.batchRevealSize)

      expect(await launchpeg.tokenURI(2 * config.batchRevealSize - 1)).to.be.equal(config.unrevealedTokenURI)
      await expect(launchpeg.connect(alice).revealNextBatch()).to.be.revertedWith(
        'Launchpeg__RevealNextBatchNotAvailable'
      )
    })

    it('NFTs should gradually reveal after revealStartTime', async () => {
      config.collectionSize = 50
      config.amountForDevs = 50
      config.amountForAuction = 0
      config.amountForAllowlist = 0
      config.batchRevealSize = 10
      await deployLaunchpeg()

      await initializePhasesLaunchpeg(launchpeg, config, Phase.Reveal)

      await launchpeg.connect(projectOwner).devMint(3 * config.batchRevealSize)

      await launchpeg.connect(alice).revealNextBatch()
      expect(await launchpeg.tokenURI(0)).to.contains(config.baseTokenURI)
      expect(await launchpeg.tokenURI(config.batchRevealSize)).to.be.equal(config.unrevealedTokenURI)

      // Too early to reveal next batch
      await expect(launchpeg.connect(bob).revealNextBatch()).to.be.revertedWith(
        'Launchpeg__RevealNextBatchNotAvailable'
      )
      await advanceTimeAndBlock(config.batchRevealInterval)

      await launchpeg.connect(bob).revealNextBatch()
      expect(await launchpeg.tokenURI(2 * config.batchRevealSize - 1)).to.contains(config.baseTokenURI)
      expect(await launchpeg.tokenURI(2 * config.batchRevealSize + 1)).to.be.equal(config.unrevealedTokenURI)
    })

    it('Should not allow user to reveal batch if batch reveal is disabled', async () => {
      config.amountForDevs = 10
      config.batchRevealSize = 0
      await initializePhasesLaunchpeg(launchpeg, config, Phase.Reveal)

      await launchpeg.connect(projectOwner).devMint(config.amountForDevs)
      await expect(launchpeg.connect(alice).revealNextBatch()).to.be.revertedWith(
        'Launchpeg__RevealNextBatchNotAvailable()'
      )
    })

    it('Owner should be able to reveal if the collection does not sell out', async () => {
      await initializePhasesLaunchpeg(launchpeg, config, Phase.PublicSale)

      // No one bought the collection :(
      await launchpeg.connect(projectOwner).devMint(config.amountForDevs)

      // Should fail since not enough tokens have been minted for a reveal
      await expect(launchpeg.connect(bob).revealNextBatch()).to.be.revertedWith(
        'Launchpeg__RevealNextBatchNotAvailable'
      )

      await expect(batchReveal.connect(bob).forceReveal()).to.be.revertedWith('Ownable: caller is not the owner')

      await batchReveal.connect(dev).forceReveal()
      // Batch 1 is revealed
      expect(await launchpeg.tokenURI(0)).to.contains(config.baseTokenURI)
      expect(await launchpeg.tokenURI(config.batchRevealSize)).to.be.equal(config.unrevealedTokenURI)
    })

    it('Should not allow owner to set reveal batch size once batch reveal has started', async () => {
      config.amountForDevs = 10
      config.batchRevealSize = 10
      await deployLaunchpeg()
      await initializePhasesLaunchpeg(launchpeg, config, Phase.Reveal)

      const newRevealBatchSize = 5
      await launchpeg.connect(projectOwner).devMint(config.batchRevealSize)
      await launchpeg.connect(alice).revealNextBatch()
      await expect(batchReveal.setRevealBatchSize(newRevealBatchSize)).to.be.revertedWith(
        'Launchpeg__BatchRevealStarted()'
      )
    })

    it('Should not allow owner to set reveal time once batch reveal has started', async () => {
      config.amountForDevs = 10
      config.batchRevealSize = 10
      await deployLaunchpeg()
      await initializePhasesLaunchpeg(launchpeg, config, Phase.Reveal)

      const newRevealStartTime = config.batchRevealStart.add(duration.minutes(30))
      await launchpeg.connect(projectOwner).devMint(config.batchRevealSize)
      await launchpeg.connect(alice).revealNextBatch()
      await expect(batchReveal.setRevealStartTime(newRevealStartTime)).to.be.revertedWith(
        'Launchpeg__BatchRevealStarted()'
      )
    })

    it('Should not allow owner to set reveal interval once batch reveal has started', async () => {
      config.amountForDevs = 10
      config.batchRevealSize = 10
      await deployLaunchpeg()
      await initializePhasesLaunchpeg(launchpeg, config, Phase.Reveal)

      const newRevealInterval = config.batchRevealInterval.add(10)
      await launchpeg.connect(projectOwner).devMint(config.batchRevealSize)
      await launchpeg.connect(alice).revealNextBatch()
      await expect(batchReveal.setRevealInterval(newRevealInterval)).to.be.revertedWith(
        'Launchpeg__BatchRevealStarted()'
      )
    })
  })

  describe('VRF', () => {
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
      ).to.be.revertedWith('Launchpeg__InvalidCoordinator')

      await expect(
        batchReveal.setVRF(coordinatorMock.address, ethers.utils.formatBytes32String('Oxff'), 1, 0)
      ).to.be.revertedWith('Launchpeg__InvalidCallbackGasLimit')

      await expect(
        batchReveal.setVRF(coordinatorMock.address, ethers.utils.formatBytes32String('Ox00'), 1, 200_000)
      ).to.be.revertedWith('Launchpeg__InvalidKeyHash')

      await coordinatorMock.removeConsumer(0, ethers.constants.AddressZero)
      await expect(
        batchReveal.setVRF(coordinatorMock.address, ethers.utils.formatBytes32String('Oxff'), 1, 200_000)
      ).to.be.revertedWith('Launchpeg__IsNotInTheConsumerList')
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

      await batchReveal.connect(dev).forceReveal()
      const token3URI = await launchpeg.tokenURI(3)
      expect(token3URI).to.contains('base')
      expect(await launchpeg.tokenURI(3 + config.batchRevealSize)).to.eq('unrevealed')

      // Coordinator's response coming too late
      await coordinatorMock.fulfillRandomWords(1, launchpeg.address)
      // Doesn't reveal anything
      expect(await launchpeg.tokenURI(3 + config.batchRevealSize)).to.eq('unrevealed')
      expect(await launchpeg.tokenURI(3)).to.eq(token3URI)
    })

    it('Should not be able to spam VRF requests', async () => {
      await launchpeg.connect(projectOwner).devMint(config.batchRevealSize)
      await launchpeg.revealNextBatch()
      await expect(launchpeg.revealNextBatch()).to.be.revertedWith('Launchpeg__RevealNextBatchNotAvailable')
    })
  })

  describe('SafePausable', () => {
    beforeEach(async () => {
      PAUSER_ROLE = await launchpeg.PAUSER_ROLE()
      UNPAUSER_ROLE = await launchpeg.UNPAUSER_ROLE()
    })

    it('Should allow owner to pause and unpause', async () => {
      await launchpeg.pause()
      expect(await launchpeg.paused()).to.eq(true)

      await launchpeg.unpause()
      expect(await launchpeg.paused()).to.eq(false)
    })

    it('Should allow user with PAUSER_ROLE to pause and UNPAUSER_ROLE to unpause', async () => {
      await expect(launchpeg.connect(alice).pause()).to.be.revertedWith(
        'SafeAccessControlEnumerableUpgradeable__SenderMissingRoleAndIsNotOwner'
      )
      await launchpeg.grantRole(PAUSER_ROLE, alice.address)
      await launchpeg.connect(alice).pause()
      expect(await launchpeg.paused()).to.eq(true)

      await expect(launchpeg.connect(alice).unpause()).to.be.revertedWith(
        'SafeAccessControlEnumerableUpgradeable__SenderMissingRoleAndIsNotOwner'
      )
      await launchpeg.grantRole(UNPAUSER_ROLE, alice.address)
      await launchpeg.connect(alice).unpause()
      expect(await launchpeg.paused()).to.eq(false)
    })

    it('Should allow owner to grant and revoke PAUSER_ROLE and UNPAUSER_ROLE', async () => {
      await launchpeg.grantRole(PAUSER_ROLE, alice.address)
      await launchpeg.connect(alice).pause()
      await launchpeg.revokeRole(PAUSER_ROLE, alice.address)
      await expect(launchpeg.connect(alice).pause()).to.be.revertedWith(
        'SafeAccessControlEnumerableUpgradeable__SenderMissingRoleAndIsNotOwner'
      )

      await launchpeg.grantRole(UNPAUSER_ROLE, alice.address)
      await launchpeg.connect(alice).unpause()
      await launchpeg.revokeRole(UNPAUSER_ROLE, alice.address)
      await expect(launchpeg.connect(alice).unpause()).to.be.revertedWith(
        'SafeAccessControlEnumerableUpgradeable__SenderMissingRoleAndIsNotOwner'
      )
    })

    it('Should not allow non-owner to grant PAUSER_ROLE and UNPAUSER_ROLE', async () => {
      await expect(launchpeg.connect(bob).grantRole(PAUSER_ROLE, alice.address)).to.be.revertedWith(
        'SafeAccessControlEnumerableUpgradeable__SenderMissingRoleAndIsNotOwner'
      )
      await expect(launchpeg.connect(bob).grantRole(UNPAUSER_ROLE, alice.address)).to.be.revertedWith(
        'SafeAccessControlEnumerableUpgradeable__SenderMissingRoleAndIsNotOwner'
      )
    })

    it('Should not allow non-owner to revoke PAUSER_ROLE and UNPAUSER_ROLE', async () => {
      await launchpeg.grantRole(PAUSER_ROLE, alice.address)
      await expect(launchpeg.connect(bob).revokeRole(PAUSER_ROLE, alice.address)).to.be.revertedWith(
        'SafeAccessControlEnumerableUpgradeable__SenderMissingRoleAndIsNotOwner'
      )
      await launchpeg.connect(alice).pause()

      await launchpeg.grantRole(UNPAUSER_ROLE, alice.address)
      await expect(launchpeg.connect(bob).revokeRole(UNPAUSER_ROLE, alice.address)).to.be.revertedWith(
        'SafeAccessControlEnumerableUpgradeable__SenderMissingRoleAndIsNotOwner'
      )
      await launchpeg.connect(alice).unpause()
    })

    it('Should allow owner or pauser to pause mint methods', async () => {
      await launchpeg.pause()
      await expect(launchpeg.connect(dev).devMint(1)).to.be.revertedWith('Pausable: paused')
      await expect(launchpeg.connect(alice).auctionMint(1)).to.be.revertedWith('Pausable: paused')
      await expect(launchpeg.connect(bob).allowlistMint(1)).to.be.revertedWith('Pausable: paused')
      await expect(launchpeg.publicSaleMint(1)).to.be.revertedWith('Pausable: paused')

      await launchpeg.unpause()
      await launchpeg.connect(dev).devMint(1)
    })

    it('Should allow owner or pauser to pause funds withdrawal', async () => {
      initializePhasesLaunchpeg(launchpeg, config, Phase.DutchAuction)
      await launchpeg.pause()
      await expect(launchpeg.connect(projectOwner).withdrawAVAX(alice.address)).to.be.revertedWith('Pausable: paused')

      await launchpeg.unpause()
      await launchpeg.connect(projectOwner).withdrawAVAX(alice.address)
    })

    it('Should allow owner or pauser to pause batch reveal', async () => {
      config.collectionSize = 50
      config.amountForDevs = 10
      config.amountForAuction = 0
      config.amountForAllowlist = 0
      config.batchRevealSize = 10
      await deployLaunchpeg()
      initializePhasesLaunchpeg(launchpeg, config, Phase.Reveal)

      await launchpeg.devMint(10)
      await launchpeg.pause()
      await expect(launchpeg.connect(alice).revealNextBatch()).to.be.revertedWith('Pausable: paused')

      await launchpeg.unpause()
      await launchpeg.connect(alice).revealNextBatch()
    })
  })

  after(async () => {
    await network.provider.request({
      method: 'hardhat_reset',
      params: [],
    })
  })
})
