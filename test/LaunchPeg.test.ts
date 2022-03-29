import { config, ethers, network } from 'hardhat'
import { expect } from 'chai'
import { advanceTimeAndBlock, latest, duration } from './utils/time'

describe('LaunchPeg', function () {
  before(async function () {
    this.LaunchPegCF = await ethers.getContractFactory('LaunchPeg')

    this.signers = await ethers.getSigners()
    this.dev = this.signers[0]
    this.alice = this.signers[1]
    this.bob = this.signers[2]
    this.carol = this.signers[3]

    await network.provider.request({
      method: 'hardhat_reset',
      params: [
        {
          forking: {
            jsonRpcUrl: (config as any).networks.avalanche.url,
          },
          live: false,
          saveDeployments: true,
          tags: ['test', 'local'],
        },
      ],
    })
  })

  beforeEach(async function () {
    this.startPrice = ethers.utils.parseUnits('1', 18)
    this.maxBatchSize = 5
    this.collectionSize = 9000
    this.amountForAuctionAndDev = 8000
    this.amountForDevs = 50
    this.launchPeg = await this.LaunchPegCF.deploy(
      'JoePEG',
      'JOEPEG',
      this.maxBatchSize,
      this.collectionSize,
      this.amountForAuctionAndDev,
      this.amountForDevs
    )
  })

  describe('Dutch auction phase', function () {
    it('NFT price decreases at correct pace', async function () {
      // Start auction
      const saleStartTime = await latest()
      this.launchPeg.setAuctionSaleStartTime(saleStartTime)

      // Verify start price
      var auctionPrice = await this.launchPeg.getAuctionPrice(saleStartTime)
      expect(auctionPrice).to.be.equal(this.startPrice)

      // 110 minutes later
      await advanceTimeAndBlock(duration.minutes(110))

      // Verify discounted price
      auctionPrice = await this.launchPeg.getAuctionPrice(saleStartTime)
      const discount = ethers.utils.parseUnits('0.05', 18).mul(5)
      expect(auctionPrice).to.be.equal(this.startPrice.sub(discount))

      // Sale ends after 340 minutes
      await advanceTimeAndBlock(duration.minutes(240))

      // Verify floor price
      auctionPrice = await this.launchPeg.getAuctionPrice(saleStartTime)
      const floorPrice = ethers.utils.parseUnits('0.15', 18)
      expect(auctionPrice).to.be.equal(floorPrice)
    })

    it('Mint reverts when sale start date not set', async function () {
      await expect(this.launchPeg.auctionMint(1)).to.be.revertedWith('sale has not started yet')
    })

    it('Mint reverts when sale has not started yet', async function () {
      const saleStartTime = await latest()
      this.launchPeg.setAuctionSaleStartTime(saleStartTime.add(60))

      await expect(this.launchPeg.auctionMint(1)).to.be.revertedWith('sale has not started yet')
    })

    it('NFT are transfered to sender when user has enough AVAX', async function () {
      const saleStartTime = await latest()
      this.launchPeg.setAuctionSaleStartTime(saleStartTime)

      const totalPrice = this.startPrice.mul(this.maxBatchSize)
      await this.dev.sendTransaction({
        to: this.alice.address,
        value: totalPrice,
      })

      expect(await this.launchPeg.balanceOf(this.alice.address)).to.equal(0)
      await this.launchPeg.connect(this.alice).auctionMint(this.maxBatchSize, { value: totalPrice })
      expect(await this.launchPeg.balanceOf(this.alice.address)).to.equal(this.maxBatchSize)
    })

    it('Refund caller when too much AVAX sent', async function () {
      const saleStartTime = await latest()
      this.launchPeg.setAuctionSaleStartTime(saleStartTime)

      const buySize = 2
      const totalPrice = this.startPrice.mul(buySize + 1)
      const aliceInitialBalance = await ethers.provider.getBalance(this.alice.address)
      await this.dev.sendTransaction({
        to: this.alice.address,
        value: totalPrice,
      })

      await this.launchPeg.connect(this.alice).auctionMint(buySize, { value: totalPrice })
      expect(await this.launchPeg.balanceOf(this.alice.address)).to.equal(buySize)
      expect(await ethers.provider.getBalance(this.alice.address)).to.be.closeTo(
        aliceInitialBalance.add(this.startPrice),
        ethers.utils.parseUnits('0.01', 18)
      )
    })
  })

  describe('Allowlist sale phase', function () {
    async function startAllowlistMintPhase(launchPeg: any) {
      const publicSaleStartTime = (await latest()).add(60)
      launchPeg.endAuctionAndSetupNonAuctionSaleInfo(ethers.utils.parseUnits('0.5', 18), ethers.utils.parseUnits('0.1', 18), publicSaleStartTime)
    }

    it('Mint revers when not started yet', async function () {
      await expect(this.launchPeg.connect(this.bob).allowlistMint()).to.be.revertedWith('allowlist sale has not begun yet')
    })

    it('Mint reverts when the caller is not on allowlist during mint phase', async function () {
      await startAllowlistMintPhase(this.launchPeg)
      await expect(this.launchPeg.connect(this.bob).allowlistMint()).to.be.revertedWith('not eligible for allowlist mint')
    })

    it("Mint reverts when the caller didn't send enough AVAX", async function () {
      await startAllowlistMintPhase(this.launchPeg)
      await this.launchPeg.seedAllowlist([this.alice.address], [1])
      await expect(this.launchPeg.connect(this.alice).allowlistMint()).to.be.revertedWith('Need to send more AVAX.')
    })
  })

  after(async function () {
    await network.provider.request({
      method: 'hardhat_reset',
      params: [],
    })
  })
})
