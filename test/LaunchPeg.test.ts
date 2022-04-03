import { config as hardhatConfig, ethers, network } from 'hardhat'
import { expect } from 'chai'
import { advanceTimeAndBlock, latest, duration } from './utils/time'
import { initializePhases, LAUNCHPEG_CONFIG, Phase } from './utils/helpers'
import { ContractFactory, Contract } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

describe('LaunchPeg', () => {
  let launchPegCF: ContractFactory
  let launchPeg: Contract

  let config = LAUNCHPEG_CONFIG
  let maxBatchSize = 5
  let collectionSize = 10000
  let amountForAuction = 8000
  let amountForMintlist = 1900
  let amountForDevs = 100

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

  beforeEach(async () => {
    launchPeg = await launchPegCF.deploy(
      'JoePEG',
      'JOEPEG',
      projectOwner.address,
      maxBatchSize,
      collectionSize,
      amountForAuction,
      amountForMintlist,
      amountForDevs
    )
  })

  describe('Initialization', () => {
    it('Amount reserved for devs, auction, mintlist but be lower than collection size', async () => {
      await expect(
        launchPegCF.deploy(
          'Name',
          'SYMBOL',
          projectOwner.address,
          maxBatchSize,
          collectionSize - 1,
          amountForAuction,
          amountForMintlist,
          amountForDevs
        )
      ).to.be.revertedWith('larger collection size needed')
    })

    it('Phases can be initialized only once', async () => {
      const saleStartTime = (await latest()).add(duration.minutes(10))
      await initializePhases(launchPeg, saleStartTime, Phase.DutchAuction)
      await expect(initializePhases(launchPeg, saleStartTime, Phase.DutchAuction)).to.be.revertedWith(
        'auction already initialized'
      )
    })

    it('AuctionStartPrice must be lower than auctionEndPrice', async () => {
      const saleStartTime = await latest()
      await expect(
        launchPeg.initializePhases(
          saleStartTime,
          ethers.utils.parseEther('1'), // start price
          ethers.utils.parseEther('1.5'), // end prices
          config.auctionPriceCurveLength,
          config.auctionDropInterval,
          saleStartTime.add(duration.minutes(10)),
          config.mintlistPrice,
          saleStartTime.add(duration.minutes(20)),
          config.publicSalePrice
        )
      ).to.be.revertedWith('auction start price lower than end price')
    })

    it('Mintlist must happen after auction', async () => {
      const saleStartTime = await latest()
      await expect(
        launchPeg.initializePhases(
          saleStartTime,
          config.startPrice,
          config.endPrice,
          config.auctionPriceCurveLength,
          config.auctionDropInterval,
          saleStartTime.sub(duration.minutes(10)),
          config.mintlistPrice,
          saleStartTime.add(duration.minutes(20)),
          config.publicSalePrice
        )
      ).to.be.revertedWith('mintlist phase must be after auction sale')
    })

    it('Public sale must happen after mintlist', async () => {
      const saleStartTime = await latest()
      await expect(
        launchPeg.initializePhases(
          saleStartTime,
          config.startPrice,
          config.endPrice,
          config.auctionPriceCurveLength,
          config.auctionDropInterval,
          saleStartTime.add(duration.minutes(10)),
          config.mintlistPrice,
          saleStartTime.sub(duration.minutes(20)),
          config.publicSalePrice
        )
      ).to.be.revertedWith('public sale must be after mintlist')
    })
  })

  describe('Dutch auction phase', () => {
    it('NFT price decreases at correct pace', async () => {
      // Start auction
      const saleStartTime = await latest()
      await initializePhases(launchPeg, saleStartTime, Phase.DutchAuction)

      // Verify start price
      var auctionPrice = await launchPeg.getAuctionPrice(saleStartTime)
      expect(auctionPrice).to.be.eq(config.startPrice)

      // 110 minutes later
      await advanceTimeAndBlock(duration.minutes(110))

      // Verify discounted price
      auctionPrice = await launchPeg.getAuctionPrice(saleStartTime)
      const discount = ethers.utils.parseUnits('0.05', 18).mul(5)
      expect(auctionPrice).to.be.eq(config.startPrice.sub(discount))

      // Sale ends after 340 minutes
      await advanceTimeAndBlock(duration.minutes(240))

      // Verify floor price
      auctionPrice = await launchPeg.getAuctionPrice(saleStartTime)
      const floorPrice = ethers.utils.parseUnits('0.15', 18)
      expect(auctionPrice).to.be.eq(floorPrice)
    })

    it('Mint reverts when sale start date not set', async () => {
      await expect(launchPeg.auctionMint(1)).to.be.revertedWith('LaunchPeg: wrong phase')
    })

    it('Mint reverts when sale has not started yet', async () => {
      const saleStartTime = (await latest()).add(duration.minutes(10))
      await initializePhases(launchPeg, saleStartTime, Phase.DutchAuction)

      await expect(launchPeg.auctionMint(1)).to.be.revertedWith('LaunchPeg: wrong phase')
    })

    it('NFT are transfered to sender when user has enough AVAX', async () => {
      const saleStartTime = await latest()
      await initializePhases(launchPeg, saleStartTime, Phase.DutchAuction)

      expect(await launchPeg.balanceOf(alice.address)).to.equal(0)
      await launchPeg.connect(alice).auctionMint(maxBatchSize, { value: config.startPrice.mul(maxBatchSize) })
      expect(await launchPeg.balanceOf(alice.address)).to.equal(maxBatchSize)
    })

    it('Refund caller when too much AVAX sent', async () => {
      const saleStartTime = await latest()
      await initializePhases(launchPeg, saleStartTime, Phase.DutchAuction)

      const quantity = 2
      const aliceInitialBalance = await ethers.provider.getBalance(alice.address)

      await launchPeg.connect(alice).auctionMint(quantity, { value: config.startPrice.mul(quantity + 1) })
      expect(await launchPeg.balanceOf(alice.address)).to.equal(quantity)
      expect(await ethers.provider.getBalance(alice.address)).to.be.closeTo(
        aliceInitialBalance.sub(config.startPrice.mul(quantity)),
        ethers.utils.parseUnits('0.01', 18)
      )
    })

    it('NFTs sold out during auction', async () => {
      launchPeg = await launchPegCF.deploy('JoePEG', 'JOEPEG', projectOwner.address, maxBatchSize, 15, 5, 5, 5)

      const saleStartTime = await latest()
      await initializePhases(launchPeg, saleStartTime, Phase.DutchAuction)

      await launchPeg.connect(projectOwner).devMint(5)
      await launchPeg.connect(alice).auctionMint(5, { value: config.startPrice.mul(5) })
      await expect(launchPeg.connect(bob).auctionMint(5, { value: config.startPrice.mul(5) })).to.be.revertedWith(
        'not enough remaining reserved for auction to support desired mint amount'
      )
    })
  })

  describe('Mintlist phase', () => {
    it('One NFT is transfered when user is on allowlist', async () => {
      const saleStartTime = await latest()
      await initializePhases(launchPeg, saleStartTime, Phase.Mintlist)

      await launchPeg.seedAllowlist([bob.address], [1])
      await launchPeg.connect(bob).allowlistMint({ value: config.mintlistPrice })
      expect(await launchPeg.balanceOf(bob.address)).to.equal(1)
    })

    it('Mint reverts when user tries to mint more NFTs than allowed', async () => {
      const saleStartTime = await latest()
      await initializePhases(launchPeg, saleStartTime, Phase.Mintlist)

      const price = config.mintlistPrice

      await launchPeg.seedAllowlist([bob.address], [2])
      await launchPeg.connect(bob).allowlistMint({ value: price.mul(2) }) // intentionally sending more AVAX to test refund
      await launchPeg.connect(bob).allowlistMint({ value: price })

      await expect(launchPeg.connect(bob).allowlistMint({ value: price })).to.be.revertedWith(
        'not eligible for allowlist mint'
      )
      expect(await launchPeg.balanceOf(bob.address)).to.equal(2)
    })

    it('Mint reverts when not started yet', async () => {
      const saleStartTime = await latest()
      await initializePhases(launchPeg, saleStartTime, Phase.DutchAuction)

      await expect(launchPeg.connect(bob).allowlistMint()).to.be.revertedWith('LaunchPeg: wrong phase')
    })

    it('Mint reverts when the caller is not on allowlist during mint phase', async () => {
      const saleStartTime = await latest()
      await initializePhases(launchPeg, saleStartTime, Phase.Mintlist)

      await expect(launchPeg.connect(bob).allowlistMint()).to.be.revertedWith('not eligible for allowlist mint')
    })

    it("Mint reverts when the caller didn't send enough AVAX", async () => {
      const saleStartTime = await latest()
      await initializePhases(launchPeg, saleStartTime, Phase.Mintlist)

      await launchPeg.seedAllowlist([alice.address], [1])
      await expect(launchPeg.connect(alice).allowlistMint()).to.be.revertedWith('Need to send more AVAX.')
    })

    it('Mint reverts during public sale', async () => {
      const saleStartTime = await latest()
      await initializePhases(launchPeg, saleStartTime, Phase.PublicSale)

      await launchPeg.seedAllowlist([alice.address], [1])
      await expect(launchPeg.connect(alice).allowlistMint()).to.be.revertedWith('LaunchPeg: wrong phase')
    })

    it('Seed allowlist reverts when addresses does not match numSlots length', async () => {
      await expect(launchPeg.seedAllowlist([alice.address, bob.address], [1])).to.be.revertedWith(
        'addresses does not match numSlots length'
      )
    })
  })

  describe('Public sale phase', () => {
    it('The correct amount of NFTs is transfered when the user mints', async () => {
      const saleStartTime = await latest()
      await initializePhases(launchPeg, saleStartTime, Phase.PublicSale)

      const quantity = 2
      await launchPeg.connect(bob).publicSaleMint(quantity, { value: config.publicSalePrice.mul(quantity) })
      expect(await launchPeg.balanceOf(bob.address)).to.equal(2)
    })

    it('Mint reverts during dutch auction', async () => {
      const saleStartTime = await latest()
      await initializePhases(launchPeg, saleStartTime, Phase.DutchAuction)

      await expect(launchPeg.connect(alice).publicSaleMint(1)).to.be.revertedWith('LaunchPeg: wrong phase')
    })

    it('Mint reverts during mintlist phase', async () => {
      const saleStartTime = await latest()
      await initializePhases(launchPeg, saleStartTime, Phase.Mintlist)

      await expect(launchPeg.connect(alice).publicSaleMint(1)).to.be.revertedWith('LaunchPeg: wrong phase')
    })

    it('Mint reverts when buy size > max allowed', async () => {
      const saleStartTime = await latest()
      await initializePhases(launchPeg, saleStartTime, Phase.PublicSale)

      await expect(launchPeg.connect(alice).publicSaleMint(6)).to.be.revertedWith('can not mint this many')
    })

    it('Mint reverts when not enough AVAX sent', async () => {
      const saleStartTime = await latest()
      await initializePhases(launchPeg, saleStartTime, Phase.PublicSale)

      await expect(launchPeg.connect(alice).publicSaleMint(2)).to.be.revertedWith('Need to send more AVAX.')
    })

    it('Mint reverts when the user already minted max amount', async () => {
      const saleStartTime = await latest()
      await initializePhases(launchPeg, saleStartTime, Phase.PublicSale)

      const value = config.publicSalePrice.mul(5)
      await launchPeg.connect(alice).publicSaleMint(5, { value })
      await expect(launchPeg.connect(alice).publicSaleMint(5, { value })).to.be.revertedWith('can not mint this many')
      expect(await launchPeg.balanceOf(alice.address)).to.equal(5)
    })

    it('User can only mint up to maxPerAddressDuringMint', async () => {
      // start auction
      const saleStartTime = await latest()
      await initializePhases(launchPeg, saleStartTime, Phase.DutchAuction)

      // mint 4 during auction
      await launchPeg.connect(alice).auctionMint(4, { value: config.startPrice.mul(4) })

      // mint 2 during public sale should revert
      await advanceTimeAndBlock(duration.minutes(20))
      await expect(launchPeg.connect(alice).publicSaleMint(2, { value: config.startPrice.mul(2) })).to.be.revertedWith(
        'can not mint this many'
      )
    })
  })

  describe('Project owner mint', () => {
    it('Mint up to max limit', async () => {
      await launchPeg.connect(projectOwner).devMint(amountForDevs)
      await expect(launchPeg.connect(projectOwner).devMint(1)).to.be.revertedWith(
        'too many already minted before dev mint'
      )
      expect(await launchPeg.balanceOf(projectOwner.address)).to.equal(amountForDevs)
    })

    it('Only dev can mint', async () => {
      await expect(launchPeg.connect(alice).devMint(1)).to.be.revertedWith('The caller is not the project owner')
    })

    it('Mint after project owner changes', async () => {
      await launchPeg.connect(dev).setProjectOwner(alice.address)
      await launchPeg.connect(alice).devMint(amountForDevs)
      expect(await launchPeg.balanceOf(alice.address)).to.equal(amountForDevs)
    })
  })

  after(async () => {
    await network.provider.request({
      method: 'hardhat_reset',
      params: [],
    })
  })
})
