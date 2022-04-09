import { config as hardhatConfig, ethers, network } from 'hardhat'
import { expect } from 'chai'
import { advanceTimeAndBlock, latest, duration } from './utils/time'
import { initializePhases, getDefaultLaunchPegConfig, Phase, LaunchPegConfig } from './utils/helpers'
import { ContractFactory, Contract } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

describe('LaunchPeg', () => {
  let launchPegCF: ContractFactory
  let launchPeg: Contract

  let config: LaunchPegConfig

  let signers: SignerWithAddress[]
  let dev: SignerWithAddress
  let alice: SignerWithAddress
  let bob: SignerWithAddress
  let projectOwner: SignerWithAddress

  before(async () => {
    launchPegCF = await ethers.getContractFactory('LaunchPeg')

    signers = await ethers.getSigners()
    dev = signers[0]
    alice = signers[1]
    bob = signers[2]
    projectOwner = signers[3]

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

  const deployLaunchPeg = async () => {
    launchPeg = await launchPegCF.deploy(
      'JoePEG',
      'JOEPEG',
      projectOwner.address,
      config.maxBatchSize,
      config.collectionSize,
      config.amountForAuction,
      config.amountForMintlist,
      config.amountForDevs
    )
  }

  beforeEach(async () => {
    config = { ...(await getDefaultLaunchPegConfig()) }
    await deployLaunchPeg()
  })

  describe('Initialization', () => {
    it('Amount reserved for devs, auction, mintlist but be lower than collection size', async () => {
      config.collectionSize = config.collectionSize - 1
      await expect(deployLaunchPeg()).to.be.revertedWith('LaunchPeg__LargerCollectionSizeNeeded()')
    })

    it('Phases can be initialized only once', async () => {
      config.auctionStartTime = (await latest()).add(duration.minutes(5))
      await deployLaunchPeg()
      await initializePhases(launchPeg, config, Phase.DutchAuction)
      await expect(initializePhases(launchPeg, config, Phase.DutchAuction)).to.be.revertedWith(
        'LaunchPeg__AuctionAlreadyInitialized()'
      )
    })

    it('AuctionStartPrice must be lower than auctionEndPrice', async () => {
      config.startPrice = ethers.utils.parseEther('1')
      config.endPrice = ethers.utils.parseEther('1.5')
      await expect(initializePhases(launchPeg, config, Phase.DutchAuction)).to.be.revertedWith(
        'LaunchPeg__EndPriceGreaterThanStartPrice()'
      )
    })

    it('Mintlist must happen after auction', async () => {
      config.mintlistStartTime = config.auctionStartTime.sub(duration.minutes(10))
      await expect(initializePhases(launchPeg, config, Phase.DutchAuction)).to.be.revertedWith(
        'LaunchPeg__MintlistBeforeAuction()'
      )
    })

    it('Public sale must happen after mintlist', async () => {
      config.publicSaleStartTime = config.auctionStartTime.sub(duration.minutes(20))

      await expect(initializePhases(launchPeg, config, Phase.DutchAuction)).to.be.revertedWith(
        'LaunchPeg__PublicSaleBeforeMintlist()'
      )
    })
  })

  describe('Dutch auction phase', () => {
    it('NFT price decreases at correct pace', async () => {
      // Start auction
      const saleStartTime = config.auctionStartTime
      await initializePhases(launchPeg, config, Phase.DutchAuction)

      // Verify start price
      var auctionPrice = await launchPeg.getAuctionPrice(saleStartTime)
      expect(auctionPrice).to.be.eq(config.startPrice)

      // 50 minutes later
      await advanceTimeAndBlock(duration.minutes(50))

      // Verify discounted price
      auctionPrice = await launchPeg.getAuctionPrice(saleStartTime)
      expect(auctionPrice).to.be.eq(ethers.utils.parseEther('0.66'))

      // 50 minutes later
      await advanceTimeAndBlock(duration.minutes(50))

      // Verify floor price
      auctionPrice = await launchPeg.getAuctionPrice(saleStartTime)
      const floorPrice = ethers.utils.parseEther('0.15')
      expect(auctionPrice).to.be.eq(floorPrice)
    })

    it('Mint reverts when sale start date not set', async () => {
      await expect(launchPeg.auctionMint(1)).to.be.revertedWith('LaunchPeg__WrongPhase()')
    })

    it('Mint reverts when sale has not started yet', async () => {
      config.auctionStartTime = (await latest()).add(duration.minutes(5))
      await initializePhases(launchPeg, config, Phase.DutchAuction)

      await expect(launchPeg.auctionMint(1)).to.be.revertedWith('LaunchPeg__WrongPhase()')
    })

    it('NFT are transfered to sender when user has enough AVAX', async () => {
      await initializePhases(launchPeg, config, Phase.DutchAuction)

      expect(await launchPeg.balanceOf(alice.address)).to.eq(0)
      await launchPeg
        .connect(alice)
        .auctionMint(config.maxBatchSize, { value: config.startPrice.mul(config.maxBatchSize) })
      expect(await launchPeg.balanceOf(alice.address)).to.eq(config.maxBatchSize)
    })

    it('Refund caller when too much AVAX sent', async () => {
      await initializePhases(launchPeg, config, Phase.DutchAuction)

      const quantity = 2
      const aliceInitialBalance = await alice.getBalance()

      await launchPeg.connect(alice).auctionMint(quantity, { value: config.startPrice.mul(quantity + 1) })
      expect(await launchPeg.balanceOf(alice.address)).to.eq(quantity)
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
      await deployLaunchPeg()
      await initializePhases(launchPeg, config, Phase.DutchAuction)

      await launchPeg.connect(projectOwner).devMint(5)
      await launchPeg.connect(alice).auctionMint(5, { value: config.startPrice.mul(5) })
      await expect(launchPeg.connect(bob).auctionMint(5, { value: config.startPrice.mul(5) })).to.be.revertedWith(
        'LaunchPeg__MaxSupplyReached()'
      )
    })

    it('Can buy when desired quantity is greater than remaining supply', async () => {
      config.collectionSize = 15
      config.amountForAuction = 5
      config.amountForMintlist = 5
      config.amountForDevs = 5
      await deployLaunchPeg()
      await initializePhases(launchPeg, config, Phase.DutchAuction)

      await launchPeg.connect(alice).auctionMint(4, { value: config.startPrice.mul(5) })
      await launchPeg.connect(projectOwner).devMint(5)
      await launchPeg.connect(bob).auctionMint(5, { value: config.startPrice.mul(5) })
      expect(await launchPeg.balanceOf(alice.address)).to.eq(4)
      expect(await launchPeg.balanceOf(bob.address)).to.eq(1)
    })
  })

  describe('Mintlist phase', () => {
    it('One NFT is transfered when user is on allowlist', async () => {
      await initializePhases(launchPeg, config, Phase.Mintlist)

      await launchPeg.seedAllowlist([bob.address], [1])
      const discount = config.startPrice.mul(config.mintlistDiscount).div(10000)
      await launchPeg.connect(bob).allowlistMint({ value: config.startPrice.sub(discount) })
      expect(await launchPeg.balanceOf(bob.address)).to.eq(1)
    })

    it('Mint reverts when user tries to mint more NFTs than allowed', async () => {
      await initializePhases(launchPeg, config, Phase.Mintlist)

      const discount = config.startPrice.mul(config.mintlistDiscount).div(10000)
      const price = config.startPrice.sub(discount)

      await launchPeg.seedAllowlist([bob.address], [2])
      await launchPeg.connect(bob).allowlistMint({ value: price.mul(2) }) // intentionally sending more AVAX to test refund
      await launchPeg.connect(bob).allowlistMint({ value: price })

      await expect(launchPeg.connect(bob).allowlistMint({ value: price })).to.be.revertedWith(
        'LaunchPeg__NotEligibleForAllowlistMint()'
      )
      expect(await launchPeg.balanceOf(bob.address)).to.eq(2)
    })

    it('Mint reverts when not started yet', async () => {
      await initializePhases(launchPeg, config, Phase.DutchAuction)

      await expect(launchPeg.connect(bob).allowlistMint()).to.be.revertedWith('LaunchPeg__WrongPhase()')
    })

    it('Mint reverts when the caller is not on allowlist during mint phase', async () => {
      await initializePhases(launchPeg, config, Phase.Mintlist)

      await expect(launchPeg.connect(bob).allowlistMint()).to.be.revertedWith(
        'LaunchPeg__NotEligibleForAllowlistMint()'
      )
    })

    it("Mint reverts when the caller didn't send enough AVAX", async () => {
      await initializePhases(launchPeg, config, Phase.Mintlist)

      await launchPeg.seedAllowlist([alice.address], [1])
      await expect(launchPeg.connect(alice).allowlistMint()).to.be.revertedWith('LaunchPeg__NotEnoughAVAX(0)')
    })

    it('Mint reverts during public sale', async () => {
      await initializePhases(launchPeg, config, Phase.PublicSale)

      await launchPeg.seedAllowlist([alice.address], [1])
      await expect(launchPeg.connect(alice).allowlistMint()).to.be.revertedWith('LaunchPeg__WrongPhase')
    })

    it('Seed allowlist reverts when addresses does not match numSlots length', async () => {
      await expect(launchPeg.seedAllowlist([alice.address, bob.address], [1])).to.be.revertedWith(
        'LaunchPeg__WrongAddressesAndNumSlotsLength()'
      )
    })

    it('Mint price is discounted', async () => {
      await initializePhases(launchPeg, config, Phase.Mintlist)
      expect(await launchPeg.getMintlistPrice()).to.eq(ethers.utils.parseUnits('0.9', 18))
    })
  })

  describe('Public sale phase', () => {
    it('The correct amount of NFTs is transfered when the user mints', async () => {
      await initializePhases(launchPeg, config, Phase.PublicSale)

      const quantity = 2
      const discount = config.startPrice.mul(config.publicSaleDiscount).div(10000)
      const price = config.startPrice.sub(discount)
      await launchPeg.connect(bob).publicSaleMint(quantity, { value: price.mul(quantity) })
      expect(await launchPeg.balanceOf(bob.address)).to.eq(2)
    })

    it('Mint reverts during dutch auction', async () => {
      await initializePhases(launchPeg, config, Phase.DutchAuction)

      await expect(launchPeg.connect(alice).publicSaleMint(1)).to.be.revertedWith('LaunchPeg__WrongPhase()')
    })

    it('Mint reverts during mintlist phase', async () => {
      await initializePhases(launchPeg, config, Phase.Mintlist)

      await expect(launchPeg.connect(alice).publicSaleMint(1)).to.be.revertedWith('LaunchPeg__WrongPhase()')
    })

    it('Mint reverts when buy size > max allowed', async () => {
      await initializePhases(launchPeg, config, Phase.PublicSale)

      await expect(launchPeg.connect(alice).publicSaleMint(6)).to.be.revertedWith('LaunchPeg__CanNotMintThisMany()')
    })

    it('Mint reverts when not enough AVAX sent', async () => {
      await initializePhases(launchPeg, config, Phase.PublicSale)

      await expect(launchPeg.connect(alice).publicSaleMint(2)).to.be.revertedWith('LaunchPeg__NotEnoughAVAX(0)')
    })

    it('Mint reverts when the user already minted max amount', async () => {
      await initializePhases(launchPeg, config, Phase.PublicSale)

      const discount = config.startPrice.mul(config.publicSaleDiscount).div(10000)
      const price = config.startPrice.sub(discount)
      const value = price.mul(5)
      await launchPeg.connect(alice).publicSaleMint(5, { value })
      await expect(launchPeg.connect(alice).publicSaleMint(5, { value })).to.be.revertedWith(
        'LaunchPeg__CanNotMintThisMany()'
      )
      expect(await launchPeg.balanceOf(alice.address)).to.eq(5)
    })

    it('User can only mint up to maxPerAddressDuringMint', async () => {
      // start auction
      await initializePhases(launchPeg, config, Phase.DutchAuction)

      // mint 4 during auction
      await launchPeg.connect(alice).auctionMint(4, { value: config.startPrice.mul(4) })

      // mint 2 during public sale should revert
      await advanceTimeAndBlock(duration.minutes(200))
      await expect(launchPeg.connect(alice).publicSaleMint(2, { value: config.startPrice.mul(2) })).to.be.revertedWith(
        'LaunchPeg__CanNotMintThisMany()'
      )
    })

    it('Public sale price is discounted', async () => {
      await initializePhases(launchPeg, config, Phase.PublicSale)
      expect(await launchPeg.getPublicSalePrice()).to.eq(ethers.utils.parseUnits('0.8', 18))
    })

    it('Public sale is limited by amount for dev', async () => {
      config.collectionSize = 10
      config.amountForAuction = 5
      config.amountForMintlist = 0
      config.amountForDevs = 5
      await deployLaunchPeg()
      await initializePhases(launchPeg, config, Phase.PublicSale)

      await launchPeg.connect(alice).publicSaleMint(5, { value: config.startPrice.mul(5) })
      await expect(launchPeg.connect(alice).publicSaleMint(5, { value: config.startPrice.mul(5) })).to.be.revertedWith(
        'LaunchPeg__MaxSupplyReached()'
      )
    })
  })

  describe('Project owner mint', () => {
    it('Mint up to max limit', async () => {
      await launchPeg.connect(projectOwner).devMint(config.amountForDevs)
      await expect(launchPeg.connect(projectOwner).devMint(1)).to.be.revertedWith('LaunchPeg__MaxSupplyReached()')
      expect(await launchPeg.balanceOf(projectOwner.address)).to.eq(config.amountForDevs)
    })

    it('Only dev can mint', async () => {
      await expect(launchPeg.connect(alice).devMint(1)).to.be.revertedWith('LaunchPeg__Unauthorized()')
    })

    it('Mint after project owner changes', async () => {
      await launchPeg.connect(dev).setProjectOwner(alice.address)
      await launchPeg.connect(alice).devMint(config.amountForDevs)
      expect(await launchPeg.balanceOf(alice.address)).to.eq(config.amountForDevs)
    })
  })

  describe('Funds flow', () => {
    it('Owner can withdraw money', async () => {
      await initializePhases(launchPeg, config, Phase.DutchAuction)

      await launchPeg.connect(alice).auctionMint(5, { value: config.startPrice.mul(5) })
      await launchPeg.connect(bob).auctionMint(4, { value: config.startPrice.mul(4) })

      const initialDevBalance = await dev.getBalance()
      await launchPeg.connect(dev).withdrawMoney()
      expect(await dev.getBalance()).to.be.closeTo(
        initialDevBalance.add(config.startPrice.mul(9)),
        ethers.utils.parseEther('0.01')
      )
    })

    it('Fee correctly sent to collector address', async () => {
      const feePercent = 200
      const feeCollector = bob
      await launchPeg.initializeJoeFee(feePercent, feeCollector.address)
      await initializePhases(launchPeg, config, Phase.DutchAuction)

      const total = config.startPrice.mul(5)
      await launchPeg.connect(alice).auctionMint(5, { value: total })

      const fee = total.mul(feePercent).div(10000)
      const initialDevBalance = await dev.getBalance()
      const initialFeeCollectorBalance = await feeCollector.getBalance()
      await launchPeg.connect(dev).withdrawMoney()
      expect(await dev.getBalance()).to.be.closeTo(
        initialDevBalance.add(total.sub(fee)),
        ethers.utils.parseEther('0.01')
      )
      expect(await feeCollector.getBalance()).to.be.eq(initialFeeCollectorBalance.add(fee))
    })
  })

  after(async () => {
    await network.provider.request({
      method: 'hardhat_reset',
      params: [],
    })
  })
})
