import { config as hardhatConfig, ethers, network } from 'hardhat'
import { expect } from 'chai'
import { advanceTimeAndBlock, latest, duration } from './utils/time'
import { initializePhases, getDefaultLaunchpegConfig, Phase, LaunchpegConfig } from './utils/helpers'
import { ContractFactory, Contract, BigNumber } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

describe('Launchpeg', () => {
  let launchpegCF: ContractFactory
  let launchpeg: Contract

  let config: LaunchpegConfig

  let signers: SignerWithAddress[]
  let dev: SignerWithAddress
  let alice: SignerWithAddress
  let bob: SignerWithAddress
  let projectOwner: SignerWithAddress
  let royaltyReceiver: SignerWithAddress

  before(async () => {
    launchpegCF = await ethers.getContractFactory('Launchpeg')

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
      config.batchRevealSize,
      config.batchRevealStart,
      config.batchRevealInterval
    )
  }

  beforeEach(async () => {
    config = { ...(await getDefaultLaunchpegConfig()) }
    await deployLaunchpeg()
  })

  describe('Initialization', () => {
    it('Amount reserved for devs, auction, mintlist but be lower than collection size', async () => {
      config.collectionSize = config.collectionSize - 1000
      await expect(deployLaunchpeg()).to.be.revertedWith('Launchpeg__LargerCollectionSizeNeeded()')

      config.amountForDevs = config.collectionSize + 1
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
          config.amountForMintlist,
          config.amountForDevs,
          config.batchRevealSize,
          config.batchRevealStart,
          config.batchRevealInterval
        )
      ).to.be.revertedWith('Launchpeg__InvalidProjectOwner()')

      launchpeg.initialize(
        'JoePEG',
        'JOEPEG',
        projectOwner.address,
        royaltyReceiver.address,
        config.maxBatchSize,
        config.collectionSize,
        config.amountForAuction,
        config.amountForMintlist,
        config.amountForDevs,
        config.batchRevealSize,
        config.batchRevealStart,
        config.batchRevealInterval
      )

      await expect(launchpeg.connect(dev).setProjectOwner(ethers.constants.AddressZero)).to.be.revertedWith(
        'Launchpeg__InvalidProjectOwner()'
      )
    })

    it('Phases can be initialized only once', async () => {
      config.auctionStartTime = (await latest()).add(duration.minutes(5))
      await deployLaunchpeg()
      await initializePhases(launchpeg, config, Phase.DutchAuction)
      await expect(initializePhases(launchpeg, config, Phase.DutchAuction)).to.be.revertedWith(
        'Launchpeg__AuctionAlreadyInitialized()'
      )
    })

    it('Auction dates should be correct', async () => {
      config.auctionDropInterval = BigNumber.from(0)
      await expect(initializePhases(launchpeg, config, Phase.DutchAuction)).to.be.revertedWith(
        'Launchpeg__InvalidAuctionDropInterval()'
      )

      config.auctionStartTime = BigNumber.from(0)
      await expect(initializePhases(launchpeg, config, Phase.DutchAuction)).to.be.revertedWith(
        'Launchpeg__InvalidAuctionStartTime()'
      )
    })

    it('AuctionStartPrice must be lower than auctionEndPrice', async () => {
      config.startPrice = ethers.utils.parseEther('1')
      config.endPrice = ethers.utils.parseEther('1.5')
      await expect(initializePhases(launchpeg, config, Phase.DutchAuction)).to.be.revertedWith(
        'Launchpeg__EndPriceGreaterThanStartPrice()'
      )
    })

    it('Mintlist must happen after auction', async () => {
      config.mintlistStartTime = config.auctionStartTime.sub(duration.minutes(10))
      await expect(initializePhases(launchpeg, config, Phase.DutchAuction)).to.be.revertedWith(
        'Launchpeg__MintlistBeforeAuction()'
      )
    })

    it('Public sale must happen after mintlist', async () => {
      config.publicSaleStartTime = config.auctionStartTime.sub(duration.minutes(20))

      await expect(initializePhases(launchpeg, config, Phase.DutchAuction)).to.be.revertedWith(
        'Launchpeg__PublicSaleBeforeMintlist()'
      )
    })

    it('Public sale and mintlist discount must be < 100%', async () => {
      config.mintlistDiscount = 10_001

      await expect(initializePhases(launchpeg, config, Phase.DutchAuction)).to.be.revertedWith(
        'Launchpeg__InvalidPercent()'
      )
    })

    it('Batch reveal dates must be coherent', async () => {
      launchpeg = await launchpegCF.deploy()

      await expect(
        launchpeg.initialize(
          'JoePEG',
          'JOEPEG',
          projectOwner.address,
          royaltyReceiver.address,
          config.maxBatchSize,
          config.collectionSize,
          config.amountForAuction,
          config.amountForMintlist,
          config.amountForDevs,
          config.batchRevealSize,
          config.batchRevealStart.add(8_640_000),
          config.batchRevealInterval
        )
      ).to.be.revertedWith('Launchpeg__InvalidRevealDates()')

      await expect(
        launchpeg.initialize(
          'JoePEG',
          'JOEPEG',
          projectOwner.address,
          royaltyReceiver.address,
          config.maxBatchSize,
          config.collectionSize,
          config.amountForAuction,
          config.amountForMintlist,
          config.amountForDevs,
          config.batchRevealSize,
          config.batchRevealStart,
          config.batchRevealInterval.add(864_000)
        )
      ).to.be.revertedWith('Launchpeg__InvalidRevealDates()')
    })
  })

  describe('Dutch auction phase', () => {
    it('NFT price decreases at correct pace', async () => {
      // Start auction
      const saleStartTime = config.auctionStartTime
      await initializePhases(launchpeg, config, Phase.DutchAuction)

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
      config.auctionStartTime = (await latest()).add(duration.minutes(5))
      await initializePhases(launchpeg, config, Phase.DutchAuction)

      await expect(launchpeg.auctionMint(1)).to.be.revertedWith('Launchpeg__WrongPhase()')
    })

    it('NFT are transfered to sender when user has enough AVAX', async () => {
      await initializePhases(launchpeg, config, Phase.DutchAuction)

      expect(await launchpeg.balanceOf(alice.address)).to.eq(0)
      await launchpeg
        .connect(alice)
        .auctionMint(config.maxBatchSize, { value: config.startPrice.mul(config.maxBatchSize) })
      expect(await launchpeg.balanceOf(alice.address)).to.eq(config.maxBatchSize)
    })

    it('Ownership data is correct', async () => {
      await initializePhases(launchpeg, config, Phase.DutchAuction)

      await launchpeg
        .connect(alice)
        .auctionMint(config.maxBatchSize, { value: config.startPrice.mul(config.maxBatchSize) })

      let ownershipData = await launchpeg.getOwnershipData(1)

      expect(ownershipData[0]).to.eq(alice.address)
      expect(ownershipData[2]).to.eq(false)
    })

    it('Refund caller when too much AVAX sent', async () => {
      await initializePhases(launchpeg, config, Phase.DutchAuction)

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
      config.amountForMintlist = 5
      config.amountForDevs = 5
      config.batchRevealSize = 5
      await deployLaunchpeg()
      await initializePhases(launchpeg, config, Phase.DutchAuction)

      await launchpeg.connect(projectOwner).devMint(5)
      await launchpeg.connect(alice).auctionMint(5, { value: config.startPrice.mul(5) })
      await expect(launchpeg.connect(bob).auctionMint(5, { value: config.startPrice.mul(5) })).to.be.revertedWith(
        'Launchpeg__MaxSupplyReached()'
      )
    })

    it('Can buy when desired quantity is greater than remaining supply', async () => {
      config.collectionSize = 15
      config.amountForAuction = 5
      config.amountForMintlist = 5
      config.amountForDevs = 5
      config.batchRevealSize = 5
      await deployLaunchpeg()
      await initializePhases(launchpeg, config, Phase.DutchAuction)

      await launchpeg.connect(alice).auctionMint(4, { value: config.startPrice.mul(5) })
      await launchpeg.connect(projectOwner).devMint(5)
      await launchpeg.connect(bob).auctionMint(5, { value: config.startPrice.mul(5) })
      expect(await launchpeg.balanceOf(alice.address)).to.eq(4)
      expect(await launchpeg.balanceOf(bob.address)).to.eq(1)
    })
  })

  describe('Mintlist phase', () => {
    it('NFT is transfered when user is on allowList', async () => {
      await initializePhases(launchpeg, config, Phase.Mintlist)

      await launchpeg.seedAllowlist([bob.address], [5])
      const discount = config.startPrice.mul(config.mintlistDiscount).div(10000)
      await launchpeg.connect(bob).allowListMint(5, { value: config.startPrice.sub(discount).mul(5) })
      expect(await launchpeg.balanceOf(bob.address)).to.eq(5)
    })

    it('Mint reverts when user tries to mint more NFTs than allowed', async () => {
      await initializePhases(launchpeg, config, Phase.Mintlist)

      const discount = config.startPrice.mul(config.mintlistDiscount).div(10000)
      const price = config.startPrice.sub(discount)

      await launchpeg.seedAllowlist([bob.address], [4])
      await launchpeg.connect(bob).allowListMint(2, { value: price.mul(3) }) // intentionally sending more AVAX to test refund
      await launchpeg.connect(bob).allowListMint(1, { value: price })

      await expect(launchpeg.connect(bob).allowListMint(2, { value: price.mul(2) })).to.be.revertedWith(
        'Launchpeg__NotEligibleForAllowlistMint()'
      )
      expect(await launchpeg.balanceOf(bob.address)).to.eq(3)
    })

    it('Mint reverts when not started yet', async () => {
      await initializePhases(launchpeg, config, Phase.DutchAuction)

      await expect(launchpeg.connect(bob).allowListMint(1)).to.be.revertedWith('Launchpeg__WrongPhase()')
    })

    it('Mint reverts when the caller is not on allowList during mint phase', async () => {
      await initializePhases(launchpeg, config, Phase.Mintlist)

      await expect(launchpeg.connect(bob).allowListMint(1)).to.be.revertedWith(
        'Launchpeg__NotEligibleForAllowlistMint()'
      )
    })

    it("Mint reverts when the caller didn't send enough AVAX", async () => {
      await initializePhases(launchpeg, config, Phase.Mintlist)

      await launchpeg.seedAllowlist([alice.address], [1])
      await expect(launchpeg.connect(alice).allowListMint(1)).to.be.revertedWith('Launchpeg__NotEnoughAVAX(0)')
    })

    it('Mint reverts during public sale', async () => {
      await initializePhases(launchpeg, config, Phase.PublicSale)

      await launchpeg.seedAllowlist([alice.address], [1])
      await expect(launchpeg.connect(alice).allowListMint(1)).to.be.revertedWith('Launchpeg__WrongPhase')
    })

    it('Seed allowList reverts when addresses does not match numSlots length', async () => {
      await expect(launchpeg.seedAllowlist([alice.address, bob.address], [1])).to.be.revertedWith(
        'Launchpeg__WrongAddressesAndNumSlotsLength()'
      )
    })

    it('Mint price is discounted', async () => {
      await initializePhases(launchpeg, config, Phase.Mintlist)
      expect(await launchpeg.getMintlistPrice()).to.eq(ethers.utils.parseUnits('0.9', 18))
    })
  })

  describe('Public sale phase', () => {
    it('The correct amount of NFTs is transfered when the user mints', async () => {
      await initializePhases(launchpeg, config, Phase.PublicSale)

      const quantity = 2
      const discount = config.startPrice.mul(config.publicSaleDiscount).div(10000)
      const price = config.startPrice.sub(discount)
      await launchpeg.connect(bob).publicSaleMint(quantity, { value: price.mul(quantity) })
      expect(await launchpeg.balanceOf(bob.address)).to.eq(2)
    })

    it('Mint reverts during dutch auction', async () => {
      await initializePhases(launchpeg, config, Phase.DutchAuction)

      await expect(launchpeg.connect(alice).publicSaleMint(1)).to.be.revertedWith('Launchpeg__WrongPhase()')
    })

    it('Mint reverts during mintlist phase', async () => {
      await initializePhases(launchpeg, config, Phase.Mintlist)

      await expect(launchpeg.connect(alice).publicSaleMint(1)).to.be.revertedWith('Launchpeg__WrongPhase()')
    })

    it('Mint reverts when buy size > max allowed', async () => {
      await initializePhases(launchpeg, config, Phase.PublicSale)

      await expect(launchpeg.connect(alice).publicSaleMint(6)).to.be.revertedWith('Launchpeg__CanNotMintThisMany()')
    })

    it('Mint reverts when not enough AVAX sent', async () => {
      await initializePhases(launchpeg, config, Phase.PublicSale)

      await expect(launchpeg.connect(alice).publicSaleMint(2)).to.be.revertedWith('Launchpeg__NotEnoughAVAX(0)')
    })

    it('Mint reverts when the user already minted max amount', async () => {
      await initializePhases(launchpeg, config, Phase.PublicSale)

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
      await initializePhases(launchpeg, config, Phase.DutchAuction)

      // mint 4 during auction
      await launchpeg.connect(alice).auctionMint(4, { value: config.startPrice.mul(4) })

      // mint 2 during public sale should revert
      await advanceTimeAndBlock(duration.minutes(200))
      await expect(launchpeg.connect(alice).publicSaleMint(2, { value: config.startPrice.mul(2) })).to.be.revertedWith(
        'Launchpeg__CanNotMintThisMany()'
      )
    })

    it('Public sale price is discounted', async () => {
      await initializePhases(launchpeg, config, Phase.PublicSale)
      expect(await launchpeg.getPublicSalePrice()).to.eq(ethers.utils.parseUnits('0.8', 18))
    })

    it('Public sale is limited by amount for dev', async () => {
      config.collectionSize = 10
      config.amountForAuction = 5
      config.amountForMintlist = 0
      config.amountForDevs = 5
      config.batchRevealSize = 5
      await deployLaunchpeg()
      await initializePhases(launchpeg, config, Phase.PublicSale)

      await launchpeg.connect(alice).publicSaleMint(5, { value: config.startPrice.mul(5) })
      await expect(launchpeg.connect(alice).publicSaleMint(5, { value: config.startPrice.mul(5) })).to.be.revertedWith(
        'Launchpeg__MaxSupplyReached()'
      )
    })
  })

  describe('Project owner mint', () => {
    it('Mint up to max limit', async () => {
      await expect(launchpeg.connect(projectOwner).devMint(config.amountForDevs - 1)).to.be.revertedWith(
        'Launchpeg__CanOnlyMintMultipleOfMaxBatchSize()'
      )
      await launchpeg.connect(projectOwner).devMint(config.amountForDevs)
      await expect(launchpeg.connect(projectOwner).devMint(1)).to.be.revertedWith('Launchpeg__MaxSupplyForDevReached()')
      expect(await launchpeg.balanceOf(projectOwner.address)).to.eq(config.amountForDevs)
    })

    it('Devs cannot mint more than maxSupply', async () => {
      config.collectionSize = 50
      config.amountForDevs = 50
      config.amountForAuction = 0
      config.amountForMintlist = 0
      config.batchRevealSize = 10
      await deployLaunchpeg()
      await initializePhases(launchpeg, config, Phase.DutchAuction)

      await launchpeg.connect(projectOwner).devMint(config.amountForDevs)
      await expect(launchpeg.connect(projectOwner).devMint(1)).to.be.revertedWith('Launchpeg__MaxSupplyReached()')
    })

    it('Only dev can mint', async () => {
      await expect(launchpeg.connect(alice).devMint(1)).to.be.revertedWith('Launchpeg__Unauthorized()')
    })

    it('Mint after project owner changes', async () => {
      await launchpeg.connect(dev).setProjectOwner(alice.address)
      await launchpeg.connect(alice).devMint(config.amountForDevs)
      expect(await launchpeg.balanceOf(alice.address)).to.eq(config.amountForDevs)
    })
  })

  describe('Funds flow', () => {
    it('Owner can withdraw money', async () => {
      await initializePhases(launchpeg, config, Phase.DutchAuction)

      await launchpeg.connect(alice).auctionMint(5, { value: config.startPrice.mul(5) })
      await launchpeg.connect(bob).auctionMint(4, { value: config.startPrice.mul(4) })

      const initialDevBalance = await dev.getBalance()
      await launchpeg.connect(dev).withdrawAVAX()
      expect(await dev.getBalance()).to.be.closeTo(
        initialDevBalance.add(config.startPrice.mul(9)),
        ethers.utils.parseEther('0.01')
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
      await initializePhases(launchpeg, config, Phase.DutchAuction)

      const total = config.startPrice.mul(5)
      await launchpeg.connect(alice).auctionMint(5, { value: total })

      const fee = total.mul(feePercent).div(10000)
      const initialDevBalance = await dev.getBalance()
      const initialFeeCollectorBalance = await feeCollector.getBalance()
      await launchpeg.connect(dev).withdrawAVAX()
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
    it('Invalid batch reveal size should be blocked', async () => {
      config.batchRevealSize = 49
      await expect(deployLaunchpeg()).to.be.revertedWith('Launchpeg__InvalidBatchRevealSize()')
    })

    it('NFTs should be unrevealed initially', async () => {
      await initializePhases(launchpeg, config, Phase.DutchAuction)
      expect(await launchpeg.tokenURI(0)).to.be.equal(config.unrevealedTokenURI)
    })

    it('First NFTs should be revealed gradually', async () => {
      config.collectionSize = 50
      config.amountForDevs = 50
      config.amountForAuction = 0
      config.amountForMintlist = 0
      config.batchRevealSize = 10
      config.batchRevealStart = BigNumber.from(0)
      config.batchRevealInterval = BigNumber.from(0)
      await deployLaunchpeg()
      await initializePhases(launchpeg, config, Phase.DutchAuction)

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
      config.amountForMintlist = 0
      config.batchRevealSize = 10
      config.batchRevealStart = BigNumber.from(0)
      config.batchRevealInterval = BigNumber.from(0)
      await deployLaunchpeg()

      await initializePhases(launchpeg, config, Phase.DutchAuction)

      await expect(launchpeg.connect(alice).revealNextBatch()).to.be.revertedWith(
        'Launchpeg__RevealNextBatchNotAvailable'
      )

      await launchpeg.connect(projectOwner).devMint(config.batchRevealSize)
      await launchpeg.connect(bob).revealNextBatch()
      await expect(launchpeg.connect(alice).revealNextBatch()).to.be.revertedWith(
        'Launchpeg__RevealNextBatchNotAvailable'
      )
    })

    it('URIs freeze correctly', async () => {
      await launchpeg.connect(dev).setBaseURI('New base URI')
      await launchpeg.connect(dev).setUnrevealedURI('New unrevealed URI')

      expect(await launchpeg.baseURI()).to.eq('New base URI')
      expect(await launchpeg.unrevealedURI()).to.eq('New unrevealed URI')

      await launchpeg.connect(dev).freezeURIs()

      await expect(launchpeg.connect(dev).setBaseURI('New base URI 2')).to.be.revertedWith('Launchpeg__FrozenURIs()')
      await expect(launchpeg.connect(dev).setUnrevealedURI('New unrevealed URI 2')).to.be.revertedWith(
        'Launchpeg__FrozenURIs()'
      )
    })
  })

  describe('Batch reveal event after sale', () => {
    it('First NFTs should not be revealed during sale', async () => {
      config.collectionSize = 50
      config.amountForDevs = 50
      config.amountForAuction = 0
      config.amountForMintlist = 0
      config.batchRevealSize = 10
      await deployLaunchpeg()
      await initializePhases(launchpeg, config, Phase.DutchAuction)

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
      config.amountForMintlist = 0
      config.batchRevealSize = 10
      await deployLaunchpeg()

      await initializePhases(launchpeg, config, Phase.Reveal)

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

    it('Owner should be able to reveal if the collection does not sell out', async () => {
      await initializePhases(launchpeg, config, Phase.PublicSale)

      // No one bought the collection :(
      await launchpeg.connect(projectOwner).devMint(config.amountForDevs)

      // Should fail since not enough tokens have been minted for a reveal
      await expect(launchpeg.connect(bob).revealNextBatch()).to.be.revertedWith(
        'Launchpeg__RevealNextBatchNotAvailable'
      )

      await expect(launchpeg.connect(bob).forceReveal()).to.be.revertedWith('Launchpeg__Unauthorized')

      await launchpeg.connect(projectOwner).forceReveal()
      // Batch 1 is revealed
      expect(await launchpeg.tokenURI(0)).to.contains(config.baseTokenURI)
      expect(await launchpeg.tokenURI(config.batchRevealSize)).to.be.equal(config.unrevealedTokenURI)
    })
  })

  after(async () => {
    await network.provider.request({
      method: 'hardhat_reset',
      params: [],
    })
  })
})
