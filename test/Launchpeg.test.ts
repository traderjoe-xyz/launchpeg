import { config as hardhatConfig, ethers, network } from 'hardhat'
import { expect } from 'chai'
import { advanceTimeAndBlock, latest, duration } from './utils/time'
import { initializePhasesLaunchpeg, getDefaultLaunchpegConfig, Phase, LaunchpegConfig } from './utils/helpers'
import { ContractFactory, Contract, BigNumber, Bytes } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

describe('Launchpeg', () => {
  let launchpegCF: ContractFactory
  let batchRevealCF: ContractFactory
  let launchpeg: Contract
  let batchReveal: Contract

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
      config.amountForAllowlist,
      config.amountForDevs
    )
    await batchReveal.configure(
      launchpeg.address,
      config.batchRevealSize,
      config.batchRevealStart,
      config.batchRevealInterval
    )
    await launchpeg.setBatchReveal(batchReveal.address)
  }

  beforeEach(async () => {
    config = await getDefaultLaunchpegConfig()
    await deployBatchReveal()
    await deployLaunchpeg()
  })

  describe('Initialize Launchpeg', () => {
    it('Should allow owner to initialize only once', async () => {
      expect(await launchpeg.amountForAuction()).to.eq(config.amountForAuction)

      await expect(
        launchpeg.initialize(
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
      ).to.be.revertedWith('Initializable: contract is already initialized')
    })

    it('Should revert if amount for devs, auction and allowlist is larger than collection size', async () => {
      config.collectionSize = config.collectionSize - 1000
      await expect(deployLaunchpeg()).to.be.revertedWith('Launchpeg__LargerCollectionSizeNeeded()')
    })
  })

  describe('Initialize phases', () => {
    it('Should allow owner to update phases if launch has not started', async () => {
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

      await initializePhasesLaunchpeg(launchpeg, config, Phase.NotStarted)
      expect(await launchpeg.auctionSaleStartTime()).to.be.eq(config.auctionStartTime)
      expect(await launchpeg.auctionStartPrice()).to.be.eq(config.startPrice)
      expect(await launchpeg.auctionEndPrice()).to.be.eq(config.endPrice)
      expect(await launchpeg.auctionDropInterval()).to.be.eq(config.auctionDropInterval)
      expect(await launchpeg.preMintStartTime()).to.be.eq(config.preMintStartTime)
      expect(await launchpeg.allowlistStartTime()).to.be.eq(config.allowlistStartTime)
      expect(await launchpeg.publicSaleStartTime()).to.be.eq(config.publicSaleStartTime)
      expect(await launchpeg.publicSaleEndTime()).to.be.eq(config.publicSaleEndTime)
      expect(await launchpeg.allowlistDiscountPercent()).to.be.eq(config.allowlistDiscount)
      expect(await launchpeg.publicSaleDiscountPercent()).to.be.eq(config.publicSaleDiscount)

      config.auctionStartTime = config.auctionStartTime.add(duration.minutes(20))
      await initializePhasesLaunchpeg(launchpeg, config, Phase.Allowlist)
      expect(await launchpeg.auctionSaleStartTime()).to.be.eq(config.auctionStartTime)

      await expect(initializePhasesLaunchpeg(launchpeg, config, Phase.Allowlist)).to.be.revertedWith(
        'Launchpeg__WrongPhase()'
      )
    })

    it('Should revert if auction times are invalid', async () => {
      const prevAuctionStartTime = config.auctionStartTime
      config.auctionStartTime = BigNumber.from(0)
      await expect(initializePhasesLaunchpeg(launchpeg, config, Phase.NotStarted)).to.be.revertedWith(
        'Launchpeg__InvalidStartTime()'
      )

      config.auctionStartTime = prevAuctionStartTime
      config.auctionDropInterval = BigNumber.from(0)
      await expect(initializePhasesLaunchpeg(launchpeg, config, Phase.NotStarted)).to.be.revertedWith(
        'Launchpeg__InvalidAuctionDropInterval()'
      )
    })

    it('Should revert if auction start price is lower or equal to auction end price', async () => {
      config.startPrice = ethers.utils.parseEther('1')
      config.endPrice = ethers.utils.parseEther('1.5')
      await expect(initializePhasesLaunchpeg(launchpeg, config, Phase.NotStarted)).to.be.revertedWith(
        'Launchpeg__EndPriceGreaterThanStartPrice()'
      )

      config.endPrice = ethers.utils.parseEther('1')
      await expect(initializePhasesLaunchpeg(launchpeg, config, Phase.NotStarted)).to.be.revertedWith(
        'Launchpeg__EndPriceGreaterThanStartPrice()'
      )
    })

    it('Should revert if pre-mint is before auction', async () => {
      config.preMintStartTime = config.auctionStartTime.sub(duration.minutes(10))
      await expect(initializePhasesLaunchpeg(launchpeg, config, Phase.NotStarted)).to.be.revertedWith(
        'Launchpeg__PreMintBeforeAuction()'
      )
    })

    it('Should revert if allowlist is before pre-mint', async () => {
      config.allowlistStartTime = config.preMintStartTime.sub(duration.minutes(10))
      await expect(initializePhasesLaunchpeg(launchpeg, config, Phase.NotStarted)).to.be.revertedWith(
        'Launchpeg__AllowlistBeforePreMint()'
      )
    })

    it('Should revert if public sale is before allowlist', async () => {
      const prevPublicSaleStartTime = config.publicSaleStartTime
      config.publicSaleStartTime = config.allowlistStartTime.sub(duration.minutes(20))
      await expect(initializePhasesLaunchpeg(launchpeg, config, Phase.NotStarted)).to.be.revertedWith(
        'Launchpeg__PublicSaleBeforeAllowlist()'
      )

      config.publicSaleStartTime = prevPublicSaleStartTime
      config.publicSaleEndTime = config.publicSaleStartTime.sub(duration.minutes(60))
      await expect(initializePhasesLaunchpeg(launchpeg, config, Phase.NotStarted)).to.be.revertedWith(
        'Launchpeg__PublicSaleEndBeforePublicSaleStart()'
      )
    })

    it('Should revert public sale and allowlist discount are > 100%', async () => {
      config.allowlistDiscount = 10_001
      await expect(initializePhasesLaunchpeg(launchpeg, config, Phase.NotStarted)).to.be.revertedWith(
        'Launchpeg__InvalidPercent()'
      )

      config.allowlistDiscount = 1_000
      config.publicSaleDiscount = 10_001
      await expect(initializePhasesLaunchpeg(launchpeg, config, Phase.NotStarted)).to.be.revertedWith(
        'Launchpeg__InvalidPercent()'
      )
    })
  })

  describe('Configure Launchpeg times', () => {
    beforeEach(async () => {
      await initializePhasesLaunchpeg(launchpeg, config, Phase.NotStarted)
    })

    it('Should allow owner to set auction sale start time', async () => {
      const newAuctionSaleStartTime = config.auctionStartTime.add(duration.minutes(30))
      await expect(launchpeg.connect(projectOwner).setAuctionSaleStartTime(newAuctionSaleStartTime)).to.be.revertedWith(
        'PendingOwnableUpgradeable__NotOwner()'
      )

      await launchpeg.setAuctionSaleStartTime(newAuctionSaleStartTime)
      expect(await launchpeg.auctionSaleStartTime()).to.eq(newAuctionSaleStartTime)
    })

    it('Should revert if auction is before block timestamp or after pre-mint', async () => {
      const blockTimestamp = await latest()
      let invalidAuctionSaleStartTime = blockTimestamp.sub(duration.minutes(30))
      await expect(launchpeg.setAuctionSaleStartTime(invalidAuctionSaleStartTime)).to.be.revertedWith(
        'Launchpeg__InvalidStartTime()'
      )

      invalidAuctionSaleStartTime = config.preMintStartTime.add(duration.minutes(30))
      await expect(launchpeg.setAuctionSaleStartTime(invalidAuctionSaleStartTime)).to.be.revertedWith(
        'Launchpeg__PreMintBeforeAuction()'
      )
    })

    it('Should allow owner to set pre-mint start time', async () => {
      const newPreMintStartTime = config.preMintStartTime.sub(duration.minutes(30))
      await expect(launchpeg.connect(projectOwner).setPreMintStartTime(newPreMintStartTime)).to.be.revertedWith(
        'PendingOwnableUpgradeable__NotOwner()'
      )

      await launchpeg.setPreMintStartTime(newPreMintStartTime)
      expect(await launchpeg.preMintStartTime()).to.eq(newPreMintStartTime)
    })

    it('Should revert if pre-mint is before auction or after allowlist', async () => {
      let invalidPreMintStartTime = config.auctionStartTime.sub(duration.minutes(30))
      await expect(launchpeg.setPreMintStartTime(invalidPreMintStartTime)).to.be.revertedWith(
        'Launchpeg__PreMintBeforeAuction()'
      )

      invalidPreMintStartTime = config.allowlistStartTime.add(duration.minutes(30))
      await expect(launchpeg.setPreMintStartTime(invalidPreMintStartTime)).to.be.revertedWith(
        'Launchpeg__AllowlistBeforePreMint()'
      )
    })

    it('Should revert when setting pre-mint and auction start times before phases are initialized', async () => {
      await deployLaunchpeg()
      const newAuctionStartTime = config.auctionStartTime.sub(duration.minutes(30))
      await expect(launchpeg.setAuctionSaleStartTime(newAuctionStartTime)).to.be.revertedWith(
        'Launchpeg__NotInitialized()'
      )

      const newPreMintStartTime = config.preMintStartTime.sub(duration.minutes(30))
      await expect(launchpeg.setPreMintStartTime(newPreMintStartTime)).to.be.revertedWith('Launchpeg__NotInitialized()')
    })
  })

  describe('Dutch auction phase', () => {
    it('Should reduce NFT price at correct pace', async () => {
      const saleStartTime = config.auctionStartTime

      // Before auction
      await initializePhasesLaunchpeg(launchpeg, config, Phase.NotStarted)
      let auctionPrice = await launchpeg.getAuctionPrice(saleStartTime)
      expect(auctionPrice).to.eq(config.startPrice)

      // Start auction
      await initializePhasesLaunchpeg(launchpeg, config, Phase.DutchAuction)

      // Verify start price
      auctionPrice = await launchpeg.getAuctionPrice(saleStartTime)
      expect(auctionPrice).to.eq(config.startPrice)

      // 50 minutes later
      await advanceTimeAndBlock(duration.minutes(50))

      // Verify discounted price
      auctionPrice = await launchpeg.getAuctionPrice(saleStartTime)
      expect(auctionPrice).to.eq(ethers.utils.parseEther('0.66'))

      // 50 minutes later
      await advanceTimeAndBlock(duration.minutes(50))

      // Verify floor price
      auctionPrice = await launchpeg.getAuctionPrice(saleStartTime)
      const floorPrice = ethers.utils.parseEther('0.15')
      expect(auctionPrice).to.be.eq(floorPrice)
    })

    it('Should allow user to auction mint', async () => {
      await initializePhasesLaunchpeg(launchpeg, config, Phase.DutchAuction)

      expect(await launchpeg.balanceOf(alice.address)).to.eq(0)
      await launchpeg
        .connect(alice)
        .auctionMint(config.maxBatchSize, { value: config.startPrice.mul(config.maxBatchSize) })
      expect(await launchpeg.balanceOf(alice.address)).to.eq(config.maxBatchSize)
      expect(await launchpeg.amountMintedDuringAuction()).to.eq(config.maxBatchSize)
    })

    it('Should show the correct ownership data after mint', async () => {
      await initializePhasesLaunchpeg(launchpeg, config, Phase.DutchAuction)

      await launchpeg
        .connect(alice)
        .auctionMint(config.maxBatchSize, { value: config.startPrice.mul(config.maxBatchSize) })

      let ownershipData = await launchpeg.getOwnershipData(1)

      expect(ownershipData[0]).to.eq(alice.address)
      expect(ownershipData[2]).to.eq(false)
    })

    it('Should refund user if user sent too much funds', async () => {
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

    it('Should revert if user did not send enough funds', async () => {
      await initializePhasesLaunchpeg(launchpeg, config, Phase.DutchAuction)
      await expect(launchpeg.connect(bob).auctionMint(1)).to.be.revertedWith('Launchpeg__NotEnoughAVAX(0)')
    })

    it('Should revert if user auction mints more than collection size', async () => {
      config.collectionSize = 15
      config.amountForAuction = 5
      config.amountForAllowlist = 5
      config.amountForDevs = 5
      config.batchRevealSize = 5
      await deployLaunchpeg()
      await initializePhasesLaunchpeg(launchpeg, config, Phase.DutchAuction)

      await launchpeg.connect(projectOwner).devMint(5)
      await launchpeg.connect(alice).auctionMint(3, { value: config.startPrice.mul(3) })
      // Alice will mint up to allocation (5) even though she sends more (3+3)
      await launchpeg.connect(alice).auctionMint(3, { value: config.startPrice.mul(3) })
      expect(await launchpeg.balanceOf(alice.address)).to.eq(5)

      await expect(launchpeg.connect(bob).auctionMint(5, { value: config.startPrice.mul(5) })).to.be.revertedWith(
        'Launchpeg__MaxSupplyReached()'
      )
    })

    it('Should revert if user auction mints more than max per address', async () => {
      config.collectionSize = 15
      config.amountForAuction = 5
      config.amountForAllowlist = 5
      config.amountForDevs = 5
      config.batchRevealSize = 5
      config.maxBatchSize = 3
      await deployLaunchpeg()
      await initializePhasesLaunchpeg(launchpeg, config, Phase.DutchAuction)

      await launchpeg.connect(alice).auctionMint(3, { value: config.startPrice.mul(3) })
      await expect(launchpeg.connect(alice).auctionMint(1)).to.be.revertedWith('Launchpeg__CanNotMintThisMany')
    })

    it('Should revert if user mints before auction has started', async () => {
      await expect(launchpeg.auctionMint(1)).to.be.revertedWith('Launchpeg__WrongPhase()')

      await initializePhasesLaunchpeg(launchpeg, config, Phase.NotStarted)

      await expect(launchpeg.auctionMint(1)).to.be.revertedWith('Launchpeg__WrongPhase()')
    })

    it('Should revert if user tries to mint for another phase', async () => {
      await expect(launchpeg.connect(alice).preMint(1)).to.be.revertedWith('Launchpeg__WrongPhase()')
      await expect(launchpeg.connect(alice).batchMintPreMintedNFTs(1)).to.be.revertedWith('Launchpeg__WrongPhase()')
      await expect(launchpeg.connect(alice).allowlistMint(1)).to.be.revertedWith('Launchpeg__WrongPhase()')
      await expect(launchpeg.connect(alice).publicSaleMint(1)).to.be.revertedWith('Launchpeg__WrongPhase()')
    })
  })

  describe('Pre-mint phase', () => {
    let allowlistPrice: BigNumber

    beforeEach(async () => {
      await initializePhasesLaunchpeg(launchpeg, config, Phase.PreMint)
      await launchpeg.connect(dev).seedAllowlist([alice.address], [5])
      const discount = config.startPrice.mul(config.allowlistDiscount).div(10000)
      allowlistPrice = config.startPrice.sub(discount)
    })

    it('Should allow whitelisted user to pre-mint', async () => {
      const quantity = 1
      await launchpeg.connect(alice).preMint(quantity, { value: allowlistPrice.mul(quantity) })
      expect(await launchpeg.amountMintedDuringPreMint()).to.eq(quantity)
    })

    it('Should not allow batch mint during pre-mint phase', async () => {
      await launchpeg.connect(alice).preMint(1, { value: allowlistPrice })
      await expect(launchpeg.connect(bob).batchMintPreMintedNFTs(1)).to.be.revertedWith('Launchpeg__WrongPhase()')
    })

    it('Should revert if user tries to mint for another phase', async () => {
      await expect(launchpeg.connect(alice).auctionMint(1)).to.be.revertedWith('Launchpeg__WrongPhase()')
      await expect(launchpeg.connect(alice).allowlistMint(1)).to.be.revertedWith('Launchpeg__WrongPhase()')
      await expect(launchpeg.connect(alice).publicSaleMint(1)).to.be.revertedWith('Launchpeg__WrongPhase()')
    })
  })

  describe('Allowlist phase', () => {
    it('Should allow whitelisted user to mint up to allowlist allocation', async () => {
      await initializePhasesLaunchpeg(launchpeg, config, Phase.Allowlist)
      await launchpeg.seedAllowlist([bob.address], [2])

      const discount = config.startPrice.mul(config.allowlistDiscount).div(10000)
      const allowlistPrice = config.startPrice.sub(discount)
      await launchpeg.connect(bob).allowlistMint(1, { value: allowlistPrice })
      // send more AVAX to test refund
      await launchpeg.connect(bob).allowlistMint(1, { value: allowlistPrice.mul(2) })
      expect(await launchpeg.balanceOf(bob.address)).to.eq(2)
      expect(await launchpeg.amountMintedDuringAllowlist()).to.eq(2)

      await expect(launchpeg.connect(bob).allowlistMint(1, { value: allowlistPrice })).to.be.revertedWith(
        'Launchpeg__NotEligibleForAllowlistMint()'
      )
      await expect(launchpeg.connect(bob).allowlistMint(1, { value: allowlistPrice })).to.be.revertedWith(
        'Launchpeg__NotEligibleForAllowlistMint()'
      )
    })

    it('Should revert if user pre-mints and allowlist mints more than collection size', async () => {
      config.collectionSize = 5
      config.amountForDevs = 0
      config.amountForAuction = 0
      config.amountForAllowlist = 5
      config.batchRevealSize = 5
      await deployLaunchpeg()
      await initializePhasesLaunchpeg(launchpeg, config, Phase.PreMint)
      await launchpeg.connect(dev).seedAllowlist([alice.address, bob.address], [5, 5])
      const discount = config.startPrice.mul(config.allowlistDiscount).div(10000)
      const allowlistPrice = config.startPrice.sub(discount)

      // Alice pre-mints
      await launchpeg.connect(alice).preMint(1, { value: allowlistPrice })

      // Bob allowlist mints
      const blockTimestamp = await latest()
      await advanceTimeAndBlock(duration.seconds(config.allowlistStartTime.sub(blockTimestamp).toNumber()))
      await launchpeg.connect(bob).allowlistMint(4, { value: allowlistPrice.mul(4) })

      await expect(launchpeg.connect(alice).allowlistMint(1, { value: allowlistPrice })).to.be.revertedWith(
        'Launchpeg__MaxSupplyReached()'
      )
    })

    it('Should revert if user did not send enough funds', async () => {
      await initializePhasesLaunchpeg(launchpeg, config, Phase.Allowlist)
      await launchpeg.seedAllowlist([alice.address], [1])

      await expect(launchpeg.connect(alice).allowlistMint(1)).to.be.revertedWith('Launchpeg__NotEnoughAVAX(0)')
    })

    it('Should return discounted allowlist price', async () => {
      await initializePhasesLaunchpeg(launchpeg, config, Phase.Allowlist)
      expect(await launchpeg.allowlistPrice()).to.eq(ethers.utils.parseUnits('0.9', 18))
    })

    it('Should allow any user to batch mint', async () => {
      await initializePhasesLaunchpeg(launchpeg, config, Phase.PreMint)
      await launchpeg.connect(dev).seedAllowlist([alice.address], [5])

      // Alice pre-mints
      const discount = config.startPrice.mul(config.allowlistDiscount).div(10000)
      const allowlistPrice = config.startPrice.sub(discount)
      const preMintQty = 2
      await launchpeg.connect(alice).preMint(preMintQty, { value: allowlistPrice.mul(preMintQty) })

      // Bob batch mints in allowlist phase
      const blockTimestamp = await latest()
      await advanceTimeAndBlock(duration.seconds(config.allowlistStartTime.sub(blockTimestamp).toNumber()))
      await launchpeg.connect(bob).batchMintPreMintedNFTs(preMintQty)
      expect(await launchpeg.balanceOf(alice.address)).to.eq(preMintQty)
    })

    it('Should revert if user tries to mint for another phase', async () => {
      await expect(launchpeg.connect(alice).auctionMint(1)).to.be.revertedWith('Launchpeg__WrongPhase()')
      await expect(launchpeg.connect(alice).preMint(1)).to.be.revertedWith('Launchpeg__WrongPhase()')
      await expect(launchpeg.connect(alice).publicSaleMint(1)).to.be.revertedWith('Launchpeg__WrongPhase()')
    })
  })

  describe('Public sale phase', () => {
    it('Should allow user to mint up to max batch size', async () => {
      await initializePhasesLaunchpeg(launchpeg, config, Phase.PublicSale)

      const quantity = config.maxBatchSize
      const discount = config.startPrice.mul(config.publicSaleDiscount).div(10000)
      const price = config.startPrice.sub(discount)
      await launchpeg.connect(bob).publicSaleMint(quantity, { value: price.mul(quantity) })
      expect(await launchpeg.balanceOf(bob.address)).to.eq(quantity)
      expect(await launchpeg.amountMintedDuringPublicSale()).to.eq(quantity)

      await expect(launchpeg.connect(bob).publicSaleMint(1, { value: price })).to.be.revertedWith(
        'Launchpeg__CanNotMintThisMany()'
      )
    })

    it('Should revert if user did not send enough funds', async () => {
      await initializePhasesLaunchpeg(launchpeg, config, Phase.PublicSale)
      await expect(launchpeg.connect(alice).publicSaleMint(2)).to.be.revertedWith('Launchpeg__NotEnoughAVAX(0)')
    })

    it('Should revert when max supply is reached', async () => {
      config.collectionSize = 10
      config.amountForAuction = 0
      config.amountForDevs = 0
      config.amountForAllowlist = 0
      config.maxBatchSize = 10
      config.batchRevealSize = 10
      await deployLaunchpeg()
      await initializePhasesLaunchpeg(launchpeg, config, Phase.PublicSale)

      let quantity = 5
      const price = await launchpeg.salePrice()
      await launchpeg.connect(bob).publicSaleMint(quantity, { value: price.mul(quantity) })

      // Alice mints more than max supply
      await expect(launchpeg.connect(alice).publicSaleMint(6)).to.be.revertedWith('Launchpeg__MaxSupplyReached()')

      // Bob mints up to max supply - phase ends
      await launchpeg.connect(bob).publicSaleMint(quantity, { value: price.mul(quantity) })

      await expect(launchpeg.connect(alice).publicSaleMint(1)).to.be.revertedWith('Launchpeg__WrongPhase()')
    })

    it('Should revert if user mints more than max per address across all mints', async () => {
      // Start auction
      await initializePhasesLaunchpeg(launchpeg, config, Phase.DutchAuction)

      // Mint 4 during auction
      await launchpeg.connect(alice).auctionMint(4, { value: config.startPrice.mul(4) })

      // Mint 2 during public sale should revert
      await advanceTimeAndBlock(duration.minutes(200))
      await expect(launchpeg.connect(alice).publicSaleMint(2, { value: config.startPrice.mul(2) })).to.be.revertedWith(
        'Launchpeg__CanNotMintThisMany()'
      )
    })

    it('Should return discounted public sale price', async () => {
      await initializePhasesLaunchpeg(launchpeg, config, Phase.PublicSale)
      expect(await launchpeg.salePrice()).to.eq(ethers.utils.parseUnits('0.8', 18))
    })

    it('Should revert if user tries to mint for another phase', async () => {
      await expect(launchpeg.connect(alice).auctionMint(1)).to.be.revertedWith('Launchpeg__WrongPhase()')
      await expect(launchpeg.connect(alice).preMint(1)).to.be.revertedWith('Launchpeg__WrongPhase()')
      await expect(launchpeg.connect(alice).allowlistMint(1)).to.be.revertedWith('Launchpeg__WrongPhase()')
    })
  })

  describe('Pause Launchpeg methods', () => {
    let PAUSER_ROLE: Bytes
    let UNPAUSER_ROLE: Bytes

    beforeEach(async () => {
      PAUSER_ROLE = await launchpeg.PAUSER_ROLE()
      UNPAUSER_ROLE = await launchpeg.UNPAUSER_ROLE()
    })

    it('Should allow owner or pauser to pause mint methods', async () => {
      await initializePhasesLaunchpeg(launchpeg, config, Phase.PublicSale)
      await launchpeg.grantRole(PAUSER_ROLE, alice.address)
      await launchpeg.connect(alice).pause()
      await expect(launchpeg.devMint(1)).to.be.revertedWith('Pausable: paused')
      await expect(launchpeg.auctionMint(1)).to.be.revertedWith('Pausable: paused')
      await expect(launchpeg.preMint(1)).to.be.revertedWith('Pausable: paused')
      await expect(launchpeg.batchMintPreMintedNFTs(1)).to.be.revertedWith('Pausable: paused')
      await expect(launchpeg.allowlistMint(1)).to.be.revertedWith('Pausable: paused')
      await expect(launchpeg.connect(bob).publicSaleMint(1)).to.be.revertedWith('Pausable: paused')

      await launchpeg.grantRole(UNPAUSER_ROLE, alice.address)
      await launchpeg.connect(alice).unpause()

      const discount = config.startPrice.mul(config.publicSaleDiscount).div(10000)
      const price = config.startPrice.sub(discount)
      await launchpeg.connect(bob).publicSaleMint(1, { value: price })
    })
  })

  after(async () => {
    await network.provider.request({
      method: 'hardhat_reset',
      params: [],
    })
  })
})
