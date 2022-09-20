import { config, ethers, network } from 'hardhat'
import { expect } from 'chai'

describe('MockPendingOwnableUpgradeable', function () {
  before(async function () {
    this.mockPendingOwnableUpgradeableCF = await ethers.getContractFactory('MockPendingOwnableUpgradeable')

    this.signers = await ethers.getSigners()
    this.dev = this.signers[0]
    this.alice = this.signers[1]
    this.bob = this.signers[2]
    this.exploiter = this.signers[2]
  })

  beforeEach(async function () {
    this.mockPendingOwnableUpgradeable = await this.mockPendingOwnableUpgradeableCF.deploy()
    await this.mockPendingOwnableUpgradeable.initialize()
  })

  it('Should not allow multiple initialization', async function () {
    await expect(this.mockPendingOwnableUpgradeable.initialize()).to.be.revertedWith(
      'Initializable: contract is already initialized'
    )
  })

  it('Should revert if a non owner tries to use owner function', async function () {
    await expect(
      this.mockPendingOwnableUpgradeable.connect(this.alice).setPendingOwner(this.alice.address)
    ).to.be.revertedWith('PendingOwnableUpgradeable__NotOwner')

    await expect(this.mockPendingOwnableUpgradeable.connect(this.alice).revokePendingOwner()).to.be.revertedWith(
      'PendingOwnableUpgradeable__NotOwner'
    )

    await expect(this.mockPendingOwnableUpgradeable.connect(this.alice).becomeOwner()).to.be.revertedWith(
      'PendingOwnableUpgradeable__NotPendingOwner'
    )

    await expect(this.mockPendingOwnableUpgradeable.connect(this.alice).renounceOwnership()).to.be.revertedWith(
      'PendingOwnableUpgradeable__NotOwner'
    )
  })

  it('Should allow owner to call ownable function', async function () {
    await expect(this.mockPendingOwnableUpgradeable.connect(this.dev).revokePendingOwner()).to.be.revertedWith(
      'PendingOwnableUpgradeable__NoPendingOwner'
    )

    await this.mockPendingOwnableUpgradeable.connect(this.dev).setPendingOwner(this.alice.address)

    await expect(
      this.mockPendingOwnableUpgradeable.connect(this.dev).setPendingOwner(this.alice.address)
    ).to.be.revertedWith('PendingOwnableUpgradeable__PendingOwnerAlreadySet')

    // Should revert on address(0)
    await expect(
      this.mockPendingOwnableUpgradeable.connect(this.dev).setPendingOwner(ethers.constants.AddressZero)
    ).to.be.revertedWith('PendingOwnableUpgradeable__AddressZero')

    await this.mockPendingOwnableUpgradeable.connect(this.dev).revokePendingOwner()

    await expect(this.mockPendingOwnableUpgradeable.connect(this.dev).revokePendingOwner()).to.be.revertedWith(
      'PendingOwnableUpgradeable__NoPendingOwner'
    )
  })

  it('Should allow the pendingOwner to become the owner and revert on the previous owner', async function () {
    await this.mockPendingOwnableUpgradeable.connect(this.dev).setPendingOwner(this.alice.address)

    await this.mockPendingOwnableUpgradeable.connect(this.alice).becomeOwner()

    await expect(
      this.mockPendingOwnableUpgradeable.connect(this.dev).setPendingOwner(this.alice.address)
    ).to.be.revertedWith('PendingOwnableUpgradeable__NotOwner')

    await expect(this.mockPendingOwnableUpgradeable.connect(this.alice).becomeOwner()).to.be.revertedWith(
      'PendingOwnableUpgradeable__NotPendingOwner'
    )
  })

  after(async function () {
    await network.provider.request({
      method: 'hardhat_reset',
      params: [],
    })
  })
})
