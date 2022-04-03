import { config as hardhatConfig, ethers, network } from 'hardhat'
import { expect } from 'chai'
import { advanceTimeAndBlock, latest, duration } from './utils/time'
import { initializePhases, LAUNCHPEG_CONFIG, fundAddressForMint } from './utils/helpers'
import { ContractFactory, Contract } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

describe('LaunchPeg', () => {
  let launchPegCF: ContractFactory
  let launchPeg: Contract

  let config = LAUNCHPEG_CONFIG
  let maxBatchSize = 5
  let collectionSize = 9000
  let amountForAuctionAndDev = 8000
  let amountForDevs = 50

  let signers: SignerWithAddress[]
  let dev: SignerWithAddress
  let alice: SignerWithAddress
  let bob: SignerWithAddress
  let carol: SignerWithAddress

  before(async () => {
    launchPegCF = await ethers.getContractFactory('LaunchPeg')

    signers = await ethers.getSigners()
    dev = signers[0]
    alice = signers[1]
    bob = signers[2]
    carol = signers[3]

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
    launchPeg = await launchPegCF.deploy('JoePEG', 'JOEPEG', maxBatchSize, collectionSize, amountForAuctionAndDev, amountForDevs)
  })

  describe('Dutch auction phase', () => {
    it('NFT price decreases at correct pace', async () => {
      // Start auction
      const saleStartTime = await latest()
      initializePhases(launchPeg, saleStartTime)

      // Verify start price
      var auctionPrice = await launchPeg.getAuctionPrice(saleStartTime)
      expect(auctionPrice).to.be.equal(config.startPrice)

      // 110 minutes later
      await advanceTimeAndBlock(duration.minutes(110))

      // Verify discounted price
      auctionPrice = await launchPeg.getAuctionPrice(saleStartTime)
      const discount = ethers.utils.parseUnits('0.05', 18).mul(5)
      expect(auctionPrice).to.be.equal(config.startPrice.sub(discount))

      // Sale ends after 340 minutes
      await advanceTimeAndBlock(duration.minutes(240))

      // Verify floor price
      auctionPrice = await launchPeg.getAuctionPrice(saleStartTime)
      const floorPrice = ethers.utils.parseUnits('0.15', 18)
      expect(auctionPrice).to.be.equal(floorPrice)
    })

    it('Mint reverts when sale start date not set', async () => {
      await expect(launchPeg.auctionMint(1)).to.be.revertedWith('LaunchPeg: wrong phase')
    })

    it('Mint reverts when sale has not started yet', async () => {
      const saleStartTime = (await latest()).add(duration.minutes(10))
      initializePhases(launchPeg, saleStartTime)

      await expect(launchPeg.auctionMint(1)).to.be.revertedWith('LaunchPeg: wrong phase')
    })

    it('NFT are transfered to sender when user has enough AVAX', async () => {
      const saleStartTime = await latest()
      initializePhases(launchPeg, saleStartTime)

      await fundAddressForMint(alice.address, maxBatchSize, config.startPrice, dev)

      expect(await launchPeg.balanceOf(alice.address)).to.equal(0)
      await launchPeg.connect(alice).auctionMint(maxBatchSize, { value: config.startPrice.mul(maxBatchSize) })
      expect(await launchPeg.balanceOf(alice.address)).to.equal(maxBatchSize)
    })

    it('Refund caller when too much AVAX sent', async () => {
      const saleStartTime = await latest()
      initializePhases(launchPeg, saleStartTime)

      const quantity = 2
      const aliceInitialBalance = await ethers.provider.getBalance(alice.address)
      await fundAddressForMint(alice.address, quantity + 1, config.startPrice, dev)

      await launchPeg.connect(alice).auctionMint(quantity, { value: config.startPrice.mul(quantity) })
      expect(await launchPeg.balanceOf(alice.address)).to.equal(quantity)
      expect(await ethers.provider.getBalance(alice.address)).to.be.closeTo(
        aliceInitialBalance.add(config.startPrice),
        ethers.utils.parseUnits('0.01', 18)
      )
    })
  })

  describe('Mintlist phase', () => {
    it('One NFT is transfered when user is on allowlist', async () => {
      const saleStartTime = await latest()
      initializePhases(launchPeg, saleStartTime)
      await advanceTimeAndBlock(duration.minutes(10))

      await fundAddressForMint(bob.address, 1, config.mintlistPrice, dev)

      await launchPeg.seedAllowlist([bob.address], [1])
      await launchPeg.connect(bob).allowlistMint({ value: config.mintlistPrice })
      expect(await launchPeg.balanceOf(bob.address)).to.equal(1)
    })

    it('Mint reverts when user tries to mint more NFTs than allowed', async () => {
      const saleStartTime = await latest()
      initializePhases(launchPeg, saleStartTime)
      await advanceTimeAndBlock(duration.minutes(10))

      const quantity = 2
      const price = config.mintlistPrice
      await fundAddressForMint(bob.address, quantity, price, dev)

      await launchPeg.seedAllowlist([bob.address], [2])
      await launchPeg.connect(bob).allowlistMint({ value: price.mul(2) }) // intentionally sending more AVAX to test refund
      await launchPeg.connect(bob).allowlistMint({ value: price })
      await expect(launchPeg.connect(bob).allowlistMint({ value: price })).to.be.revertedWith('not eligible for allowlist mint')
      expect(await launchPeg.balanceOf(bob.address)).to.equal(2)
    })

    it('Mint reverts when not started yet', async () => {
      const saleStartTime = await latest()
      initializePhases(launchPeg, saleStartTime)

      await expect(launchPeg.connect(bob).allowlistMint()).to.be.revertedWith('LaunchPeg: wrong phase')
    })

    it('Mint reverts when the caller is not on allowlist during mint phase', async () => {
      const saleStartTime = await latest()
      initializePhases(launchPeg, saleStartTime)
      await advanceTimeAndBlock(duration.minutes(10))

      await expect(launchPeg.connect(bob).allowlistMint()).to.be.revertedWith('not eligible for allowlist mint')
    })

    it("Mint reverts when the caller didn't send enough AVAX", async () => {
      const saleStartTime = await latest()
      initializePhases(launchPeg, saleStartTime)
      await advanceTimeAndBlock(duration.minutes(10))

      await launchPeg.seedAllowlist([alice.address], [1])
      await expect(launchPeg.connect(alice).allowlistMint()).to.be.revertedWith('Need to send more AVAX.')
    })

    it('Mint reverts during public sale', async () => {
      const saleStartTime = await latest()
      initializePhases(launchPeg, saleStartTime)
      await advanceTimeAndBlock(duration.minutes(20))

      await launchPeg.seedAllowlist([alice.address], [1])
      await expect(launchPeg.connect(alice).allowlistMint()).to.be.revertedWith('LaunchPeg: wrong phase')
    })
  })

  describe('Public sale phase', () => {
    it('The correct amount of NFTs is transfered when the user mints', async () => {
      const saleStartTime = await latest()
      initializePhases(launchPeg, saleStartTime)
      await advanceTimeAndBlock(duration.minutes(20))

      const quantity = 2
      await fundAddressForMint(bob.address, quantity, config.publicSalePrice, dev)

      await launchPeg.connect(bob).publicSaleMint(quantity, { value: config.publicSalePrice.mul(quantity) })
      expect(await launchPeg.balanceOf(bob.address)).to.equal(2)
    })

    it('Mint reverts during dutch auction', async () => {
      const saleStartTime = await latest()
      initializePhases(launchPeg, saleStartTime)

      await expect(launchPeg.connect(alice).publicSaleMint(1)).to.be.revertedWith('LaunchPeg: wrong phase')
    })

    it('Mint reverts during mintlist phase', async () => {
      const saleStartTime = await latest()
      initializePhases(launchPeg, saleStartTime)
      await advanceTimeAndBlock(duration.minutes(10))

      await expect(launchPeg.connect(alice).publicSaleMint(1)).to.be.revertedWith('LaunchPeg: wrong phase')
    })

    it('Mint reverts when buy size > max allowed', async () => {
      const saleStartTime = await latest()
      initializePhases(launchPeg, saleStartTime)
      await advanceTimeAndBlock(duration.minutes(20))

      await expect(launchPeg.connect(alice).publicSaleMint(6)).to.be.revertedWith('can not mint this many')
    })

    it('Mint reverts when not enough AVAX sent', async () => {
      const saleStartTime = await latest()
      initializePhases(launchPeg, saleStartTime)
      await advanceTimeAndBlock(duration.minutes(20))

      await fundAddressForMint(alice.address, 1, config.publicSalePrice, dev)

      await expect(launchPeg.connect(alice).publicSaleMint(2)).to.be.revertedWith('Need to send more AVAX.')
    })

    it('Mint reverts when the user already minted max amount', async () => {
      const saleStartTime = await latest()
      initializePhases(launchPeg, saleStartTime)
      await advanceTimeAndBlock(duration.minutes(20))

      await fundAddressForMint(alice.address, 10, config.publicSalePrice, dev)

      const value = config.publicSalePrice.mul(5)
      await launchPeg.connect(alice).publicSaleMint(5, { value })
      await expect(launchPeg.connect(alice).publicSaleMint(5, { value })).to.be.revertedWith('can not mint this many')
      expect(await launchPeg.balanceOf(alice.address)).to.equal(5)
    })
  })

  after(async () => {
    await network.provider.request({
      method: 'hardhat_reset',
      params: [],
    })
  })
})
