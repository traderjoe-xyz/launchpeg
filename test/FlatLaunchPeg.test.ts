import { config as hardhatConfig, ethers, network } from 'hardhat'
import { expect } from 'chai'
import { getDefaultLaunchPegConfig, Phase, LaunchPegConfig } from './utils/helpers'
import { ContractFactory, Contract } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

describe('FlatLaunchPeg', () => {
  let flatLaunchPegCF: ContractFactory
  let flatLaunchPeg: Contract

  let config: LaunchPegConfig

  let signers: SignerWithAddress[]
  let dev: SignerWithAddress
  let alice: SignerWithAddress
  let bob: SignerWithAddress
  let projectOwner: SignerWithAddress

  before(async () => {
    flatLaunchPegCF = await ethers.getContractFactory('FlatLaunchPeg')

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

  const deployFlatLaunchPeg = async () => {
    flatLaunchPeg = await flatLaunchPegCF.deploy(
      'JoePEG',
      'JOEPEG',
      projectOwner.address,
      config.collectionSize,
      config.maxBatchSize,
      config.flatPublicSalePrice,
      config.flatMintListSalePrice
    )
  }

  beforeEach(async () => {
    config = { ...(await getDefaultLaunchPegConfig()) }
    await deployFlatLaunchPeg()
    await flatLaunchPeg.flipSaleState()
  })

  describe('Project owner mint', () => {
    it('Mint', async () => {
      await flatLaunchPeg.connect(projectOwner).devMint(config.amountForDevs)
      expect(await flatLaunchPeg.balanceOf(projectOwner.address)).to.eq(config.amountForDevs)
    })

    it('Only dev can mint', async () => {
      await expect(flatLaunchPeg.connect(alice).devMint(1)).to.be.revertedWith('LaunchPeg__Unauthorized()')
    })

    it('Mint after project owner changes', async () => {
      await flatLaunchPeg.connect(dev).setProjectOwner(alice.address)
      await flatLaunchPeg.connect(alice).devMint(config.amountForDevs)
      expect(await flatLaunchPeg.balanceOf(alice.address)).to.eq(config.amountForDevs)
    })
  })

  describe('Mintlist phase', () => {
    it('One NFT is transfered when user is on allowlist', async () => {
      await flatLaunchPeg.connect(dev).seedAllowlist([bob.address], [1])
      await flatLaunchPeg.connect(bob).allowlistMint({ value: config.flatMintListSalePrice })
      expect(await flatLaunchPeg.balanceOf(bob.address)).to.eq(1)
    })

    it('Mint reverts when user tries to mint more NFTs than allowed', async () => {
      const price = config.flatMintListSalePrice

      await flatLaunchPeg.connect(dev).seedAllowlist([bob.address], [2])
      await flatLaunchPeg.connect(bob).allowlistMint({ value: price.mul(2) }) // intentionally sending more AVAX to test refund
      await flatLaunchPeg.connect(bob).allowlistMint({ value: price })

      await expect(flatLaunchPeg.connect(bob).allowlistMint({ value: price })).to.be.revertedWith(
        'LaunchPeg__NotEligibleForAllowlistMint()'
      )
      expect(await flatLaunchPeg.balanceOf(bob.address)).to.eq(2)
    })

    it('Mint reverts when the caller is not on allowlist during mint phase', async () => {
      await expect(flatLaunchPeg.connect(bob).allowlistMint()).to.be.revertedWith(
        'LaunchPeg__NotEligibleForAllowlistMint()'
      )
    })

    it("Mint reverts when the caller didn't send enough AVAX", async () => {
      await flatLaunchPeg.connect(dev).seedAllowlist([alice.address], [1])
      await expect(flatLaunchPeg.connect(alice).allowlistMint()).to.be.revertedWith('LaunchPeg__NotEnoughAVAX(0)')
    })

    it('Seed allowlist reverts when addresses does not match numSlots length', async () => {
      await expect(flatLaunchPeg.connect(dev).seedAllowlist([alice.address, bob.address], [1])).to.be.revertedWith(
        'LaunchPeg__WrongAddressesAndNumSlotsLength()'
      )
    })
  })

  describe('Public sale phase', () => {
    it('The correct amount of NFTs is transfered when the user mints', async () => {
      const quantity = 2
      const price = config.flatPublicSalePrice
      await flatLaunchPeg.connect(bob).publicSaleMint(quantity, { value: price.mul(quantity) })
      expect(await flatLaunchPeg.balanceOf(bob.address)).to.eq(2)
    })

    it('Mint reverts when buy size > max allowed', async () => {
      await expect(flatLaunchPeg.connect(alice).publicSaleMint(6)).to.be.revertedWith('LaunchPeg__CanNotMintThisMany()')
    })

    it('Mint reverts when not enough AVAX sent', async () => {
      await expect(flatLaunchPeg.connect(alice).publicSaleMint(2)).to.be.revertedWith('LaunchPeg__NotEnoughAVAX(0)')
    })

    it('Mint reverts when sale is off', async () => {
      await flatLaunchPeg.connect(dev).flipSaleState()
      await expect(flatLaunchPeg.connect(alice).publicSaleMint(6)).to.be.revertedWith('LaunchPeg__SaleClosed()')
    })
  })

  describe('Transfers', () => {
    it('Owner of an NFT should be able to transfer it', async () => {
      const quantity = 2
      const price = config.flatPublicSalePrice
      await flatLaunchPeg.connect(bob).publicSaleMint(quantity, { value: price.mul(quantity) })
      expect(await flatLaunchPeg.ownerOf(1)).to.eq(bob.address)
      await flatLaunchPeg.connect(bob).transferFrom(bob.address, alice.address, 1)
      expect(await flatLaunchPeg.ownerOf(1)).to.eq(alice.address)
    })

    it('Owner of an NFT should be able to give allowance', async () => {
      const quantity = 2
      const price = config.flatPublicSalePrice
      await flatLaunchPeg.connect(bob).publicSaleMint(quantity, { value: price.mul(quantity) })

      await flatLaunchPeg.connect(bob).approve(alice.address, 1)
      await flatLaunchPeg.connect(alice).transferFrom(bob.address, alice.address, 1)
      expect(await flatLaunchPeg.ownerOf(1)).to.eq(alice.address)
    })

    it('TransferFrom with no allowance should fail', async () => {
      const quantity = 2
      const price = config.flatPublicSalePrice
      await flatLaunchPeg.connect(bob).publicSaleMint(quantity, { value: price.mul(quantity) })
      await expect(flatLaunchPeg.connect(alice).transferFrom(bob.address, alice.address, 1)).to.be.revertedWith(
        'ERC721: transfer caller is not owner nor approved'
      )
      expect(await flatLaunchPeg.ownerOf(1)).to.eq(bob.address)
    })
  })

  describe('Funds flow', () => {
    it('Owner can withdraw money', async () => {
      await flatLaunchPeg.connect(alice).publicSaleMint(5, { value: config.flatPublicSalePrice.mul(5) })
      await flatLaunchPeg.connect(bob).publicSaleMint(4, { value: config.flatPublicSalePrice.mul(4) })

      const initialDevBalance = await dev.getBalance()
      await flatLaunchPeg.connect(dev).withdrawMoney()
      expect(await dev.getBalance()).to.be.closeTo(
        initialDevBalance.add(config.flatPublicSalePrice.mul(9)),
        ethers.utils.parseEther('0.01')
      )
    })

    it('Fee correctly sent to collector address', async () => {
      const initialContractBalance = await ethers.provider.getBalance(flatLaunchPeg.address)
      const feePercent = 200
      const feeCollector = bob
      await flatLaunchPeg.initializeJoeFee(feePercent, feeCollector.address)

      const total = config.flatPublicSalePrice.mul(5).add(initialContractBalance)
      await flatLaunchPeg.connect(alice).publicSaleMint(5, { value: config.flatPublicSalePrice.mul(5) })

      const fee = total.mul(feePercent).div(10000)
      const initialDevBalance = await dev.getBalance()
      const initialFeeCollectorBalance = await feeCollector.getBalance()
      await flatLaunchPeg.connect(dev).withdrawMoney()

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
