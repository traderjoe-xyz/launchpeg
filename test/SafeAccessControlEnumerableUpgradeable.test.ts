import { config, ethers, network } from 'hardhat'
import { expect } from 'chai'

const DEFAULT_ADMIN = '0x0000000000000000000000000000000000000000000000000000000000000000'
const A_ADMIN_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes('A_ADMIN_ROLE'))
const A_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes('A_ROLE'))
const B_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes('B_ROLE'))

describe('SafeAccessControlEnumerableUpgradeable', function () {
  before(async function () {
    this.safeAccessControlEnumerableCF = await ethers.getContractFactory('MockSafeAccessControlEnumerableUpgradeable')

    this.signers = await ethers.getSigners()
    this.dev = this.signers[0]
    this.alice = this.signers[1]
    this.bob = this.signers[2]
    this.exploiter = this.signers[2]
  })

  beforeEach(async function () {
    this.safeAccess = await this.safeAccessControlEnumerableCF.deploy()
    await this.safeAccess.initialize()
  })

  it('Should allow owner to grant role', async function () {
    await this.safeAccess.grantRole(A_ROLE, this.alice.address)

    await this.safeAccess.grantRole(A_ROLE, this.bob.address)
    await this.safeAccess.grantRole(B_ROLE, this.bob.address)

    expect(await this.safeAccess.hasRole(A_ROLE, this.alice.address)).to.be.equal(true)
    expect(await this.safeAccess.hasRole(B_ROLE, this.alice.address)).to.be.equal(false)
    expect(await this.safeAccess.hasRole(A_ROLE, this.bob.address)).to.be.equal(true)
    expect(await this.safeAccess.hasRole(B_ROLE, this.bob.address)).to.be.equal(true)
  })

  it('Should allow owner to revoke role', async function () {
    await this.safeAccess.grantRole(A_ROLE, this.alice.address)

    await this.safeAccess.grantRole(A_ROLE, this.bob.address)
    await this.safeAccess.grantRole(B_ROLE, this.bob.address)

    await this.safeAccess.revokeRole(A_ROLE, this.alice.address)
    await this.safeAccess.revokeRole(B_ROLE, this.bob.address)

    expect(await this.safeAccess.hasRole(A_ROLE, this.alice.address)).to.be.equal(false)
    expect(await this.safeAccess.hasRole(B_ROLE, this.alice.address)).to.be.equal(false)
    expect(await this.safeAccess.hasRole(A_ROLE, this.bob.address)).to.be.equal(true)
    expect(await this.safeAccess.hasRole(B_ROLE, this.bob.address)).to.be.equal(false)
  })

  it('Should allow user to revoke role', async function () {
    await this.safeAccess.grantRole(A_ROLE, this.alice.address)

    await this.safeAccess.connect(this.alice).renounceRole(A_ROLE, this.alice.address)

    expect(await this.safeAccess.hasRole(A_ROLE, this.alice.address)).to.be.equal(false)
  })

  it('Should transfer DEFAULT_ADMIN to new owner', async function () {
    expect(await this.safeAccess.owner()).to.be.equal(this.dev.address)

    expect(await this.safeAccess.hasRole(DEFAULT_ADMIN, this.dev.address)).to.be.equal(true)
    expect(await this.safeAccess.hasRole(DEFAULT_ADMIN, this.alice.address)).to.be.equal(false)

    await this.safeAccess.connect(this.dev).setPendingOwner(this.alice.address)
    await this.safeAccess.connect(this.alice).becomeOwner()

    expect(await this.safeAccess.owner()).to.be.equal(this.alice.address)

    expect(await this.safeAccess.hasRole(DEFAULT_ADMIN, this.dev.address)).to.be.equal(false)
    expect(await this.safeAccess.hasRole(DEFAULT_ADMIN, this.alice.address)).to.be.equal(true)
  })

  it('Should allow to renounce ownership', async function () {
    expect(await this.safeAccess.owner()).to.be.equal(this.dev.address)
    await this.safeAccess.renounceOwnership()

    expect(await this.safeAccess.owner()).to.be.equal(ethers.constants.AddressZero)

    expect(await this.safeAccess.getRoleMemberCount(DEFAULT_ADMIN)).to.be.equal(0)
  })

  it('Should allow role admin to grant role', async function () {
    await this.safeAccess.setRoleAdmin(A_ROLE, A_ADMIN_ROLE)

    expect(await this.safeAccess.getRoleAdmin(A_ROLE)).to.be.equal(A_ADMIN_ROLE)

    await this.safeAccess.grantRole(A_ADMIN_ROLE, this.alice.address)

    await this.safeAccess.connect(this.alice).grantRole(A_ROLE, this.bob.address)

    expect(await this.safeAccess.hasRole(A_ROLE, this.bob.address)).to.be.equal(true)

    await expect(this.safeAccess.connect(this.bob).grantRole(A_ROLE, this.alice.address)).to.be.revertedWith(
      'SafeAccessControlEnumerableUpgradeable__SenderMissingRoleAndIsNotOwner'
    )

    await this.safeAccess.connect(this.alice).revokeRole(A_ROLE, this.bob.address)

    expect(await this.safeAccess.hasRole(A_ROLE, this.bob.address)).to.be.equal(false)

    await this.safeAccess.setRoleAdmin(A_ROLE, DEFAULT_ADMIN)

    await expect(this.safeAccess.connect(this.alice).grantRole(A_ROLE, this.alice.address)).to.be.revertedWith(
      'SafeAccessControlEnumerableUpgradeable__SenderMissingRoleAndIsNotOwner'
    )
  })

  it('Should revert if a non owner tries to grant or revoke the contract', async function () {
    await expect(this.safeAccess.connect(this.alice).grantRole(A_ROLE, this.alice.address)).to.be.revertedWith(
      'SafeAccessControlEnumerableUpgradeable__SenderMissingRoleAndIsNotOwner'
    )
    await expect(this.safeAccess.connect(this.alice).grantRole(A_ROLE, this.bob.address)).to.be.revertedWith(
      'SafeAccessControlEnumerableUpgradeable__SenderMissingRoleAndIsNotOwner'
    )

    await expect(this.safeAccess.connect(this.alice).revokeRole(A_ROLE, this.alice.address)).to.be.revertedWith(
      'SafeAccessControlEnumerableUpgradeable__SenderMissingRoleAndIsNotOwner'
    )
    await expect(this.safeAccess.connect(this.alice).revokeRole(A_ROLE, this.bob.address)).to.be.revertedWith(
      'SafeAccessControlEnumerableUpgradeable__SenderMissingRoleAndIsNotOwner'
    )

    await expect(this.safeAccess.connect(this.alice).renounceRole(A_ROLE, this.bob.address)).to.be.revertedWith(
      'AccessControl: can only renounce roles for self'
    )
  })

  it('Should revert if trying to revert or grant DEFAULT_ADMIN', async function () {
    await expect(this.safeAccess.connect(this.alice).grantRole(DEFAULT_ADMIN, this.alice.address)).to.be.revertedWith(
      'SafeAccessControlEnumerableUpgradeable__RoleIsDefaultAdmin'
    )
    await expect(this.safeAccess.connect(this.dev).grantRole(DEFAULT_ADMIN, this.bob.address)).to.be.revertedWith(
      'SafeAccessControlEnumerableUpgradeable__RoleIsDefaultAdmin'
    )

    await expect(this.safeAccess.connect(this.alice).revokeRole(DEFAULT_ADMIN, this.alice.address)).to.be.revertedWith(
      'SafeAccessControlEnumerableUpgradeable__RoleIsDefaultAdmin'
    )
    await expect(this.safeAccess.connect(this.dev).revokeRole(DEFAULT_ADMIN, this.bob.address)).to.be.revertedWith(
      'SafeAccessControlEnumerableUpgradeable__RoleIsDefaultAdmin'
    )

    await expect(this.safeAccess.connect(this.alice).renounceRole(DEFAULT_ADMIN, this.dev.address)).to.be.revertedWith(
      'SafeAccessControlEnumerableUpgradeable__RoleIsDefaultAdmin'
    )
    await expect(this.safeAccess.connect(this.dev).renounceRole(DEFAULT_ADMIN, this.dev.address)).to.be.revertedWith(
      'SafeAccessControlEnumerableUpgradeable__RoleIsDefaultAdmin'
    )
  })

  it('Should revert if trying to initialize again', async function () {
    await expect(this.safeAccess.initialize()).to.be.revertedWith('Initializable: contract is already initialized')
  })

  after(async function () {
    await network.provider.request({
      method: 'hardhat_reset',
      params: [],
    })
  })
})
