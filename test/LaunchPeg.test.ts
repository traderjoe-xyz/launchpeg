import { config as hardhatConfig, ethers, network } from 'hardhat'
import { expect } from 'chai'
import { advanceTimeAndBlock, latest, duration } from './utils/time'
import { initializePhases, LAUNCHPEG_CONFIG } from './utils/helpers'
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

      const totalPrice = config.startPrice.mul(maxBatchSize)
      await dev.sendTransaction({
        to: alice.address,
        value: totalPrice,
      })

      expect(await launchPeg.balanceOf(alice.address)).to.equal(0)
      await launchPeg.connect(alice).auctionMint(maxBatchSize, { value: totalPrice })
      expect(await launchPeg.balanceOf(alice.address)).to.equal(maxBatchSize)
    })

    it('Refund caller when too much AVAX sent', async () => {
      const saleStartTime = await latest()
      initializePhases(launchPeg, saleStartTime)

      const buySize = 2
      const totalPrice = config.startPrice.mul(buySize + 1)
      const aliceInitialBalance = await ethers.provider.getBalance(alice.address)
      await dev.sendTransaction({
        to: alice.address,
        value: totalPrice,
      })

      await launchPeg.connect(alice).auctionMint(buySize, { value: totalPrice })
      expect(await launchPeg.balanceOf(alice.address)).to.equal(buySize)
      expect(await ethers.provider.getBalance(alice.address)).to.be.closeTo(
        aliceInitialBalance.add(config.startPrice),
        ethers.utils.parseUnits('0.01', 18)
      )
    })
  })

  describe('Allowlist sale phase', () => {
    it('Mint revers when not started yet', async () => {
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
  })

  after(async () => {
    await network.provider.request({
      method: 'hardhat_reset',
      params: [],
    })
  })
})
