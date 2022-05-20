import { config as hardhatConfig, ethers, network } from 'hardhat'
import { expect } from 'chai'
import { getDefaultLaunchpegConfig, Phase, LaunchpegConfig, initializePhasesFlatLaunchpeg } from './utils/helpers'
import { ContractFactory, Contract, BigNumber } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { duration } from './utils/time'

describe('FlatLaunchpeg', () => {
  let flatLaunchpegCF: ContractFactory
  let flatLaunchpeg: Contract

  let config: LaunchpegConfig

  let signers: SignerWithAddress[]
  let dev: SignerWithAddress
  let alice: SignerWithAddress
  let bob: SignerWithAddress
  let projectOwner: SignerWithAddress
  let royaltyReceiver: SignerWithAddress

  before(async () => {
    flatLaunchpegCF = await ethers.getContractFactory('FlatLaunchpeg')

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
      config.amountForAllowlist,
      config.batchRevealSize,
      config.batchRevealStart,
      config.batchRevealInterval
    )
  }

  beforeEach(async () => {
    config = { ...(await getDefaultLaunchpegConfig()) }
    await deployFlatLaunchpeg()
  })

  describe('Initialization', () => {
    it('Phases can be initialized only once', async () => {
      await initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.NotStarted)
      await expect(initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.Allowlist)).to.be.revertedWith(
        'Launchpeg__PhasesAlreadyInitialized()'
      )
    })

    it('Sale dates should be correct', async () => {
      config.allowlistStartTime = BigNumber.from(0)
      await expect(initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.Allowlist)).to.be.revertedWith(
        'Launchpeg__InvalidStartTime()'
      )
    })

    it('Public sale must happen after allowlist', async () => {
      config.publicSaleStartTime = config.allowlistStartTime.sub(duration.minutes(20))

      await expect(initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.Allowlist)).to.be.revertedWith(
        'Launchpeg__PublicSaleBeforeAllowlist()'
      )
    })

    it('Allowlist price should be lower than Public sale', async () => {
      config.flatAllowlistSalePrice = config.flatAllowlistSalePrice.mul(10)
      await expect(initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.NotStarted)).to.be.revertedWith(
        'Launchpeg__InvalidAllowlistPrice()'
      )
    })
  })

  describe('Project owner mint', () => {
    it('Mint', async () => {
      await flatLaunchpeg.connect(projectOwner).devMint(config.amountForDevs)
      expect(await flatLaunchpeg.balanceOf(projectOwner.address)).to.eq(config.amountForDevs)
    })

    it('Only dev can mint', async () => {
      await expect(flatLaunchpeg.connect(alice).devMint(1)).to.be.revertedWith('Launchpeg__Unauthorized()')
    })

    it('Mint after project owner changes', async () => {
      await flatLaunchpeg.connect(dev).setProjectOwner(alice.address)
      await flatLaunchpeg.connect(alice).devMint(config.amountForDevs)
      expect(await flatLaunchpeg.balanceOf(alice.address)).to.eq(config.amountForDevs)
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
  })

  describe('Public sale phase', () => {
    it('The correct amount of NFTs is transfered when the user mints', async () => {
      await initializePhasesFlatLaunchpeg(flatLaunchpeg, config, Phase.PublicSale)

      const quantity = 2
      const price = config.flatPublicSalePrice
      await flatLaunchpeg.connect(bob).publicSaleMint(quantity, { value: price.mul(quantity) })
      expect(await flatLaunchpeg.balanceOf(bob.address)).to.eq(2)
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

      let quantity = 10
      const price = config.flatPublicSalePrice
      await flatLaunchpeg.connect(bob).publicSaleMint(quantity, { value: price.mul(quantity) })

      quantity = 1
      await expect(flatLaunchpeg.connect(alice).publicSaleMint(quantity)).to.be.revertedWith(
        'Launchpeg__MaxSupplyReached()'
      )
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

  after(async () => {
    await network.provider.request({
      method: 'hardhat_reset',
      params: [],
    })
  })
})
