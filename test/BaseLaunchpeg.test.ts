import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { ContractFactory, Contract, BigNumber, Bytes } from 'ethers'
import { config as hardhatConfig, ethers, network } from 'hardhat'
import { initializePhasesLaunchpeg, getDefaultLaunchpegConfig, Phase, LaunchpegConfig } from './utils/helpers'
import { advanceTimeAndBlock, latest, duration } from './utils/time'

describe('Launchpeg', () => {
  let launchpegCF: ContractFactory
  let batchRevealCF: ContractFactory
  let launchpeg: Contract
  let batchReveal: Contract

  let config: LaunchpegConfig

  let signers: SignerWithAddress[]
  let dev: SignerWithAddress
  let alice: SignerWithAddress
  let bob: SignerWithAddress
  let projectOwner: SignerWithAddress
  let royaltyReceiver: SignerWithAddress

  before(async () => {
    launchpegCF = await ethers.getContractFactory('Launchpeg')
    batchRevealCF = await ethers.getContractFactory('BatchReveal')

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
          live: false,
          saveDeployments: true,
          tags: ['test', 'local'],
        },
      ],
    })
  })

  const deployBatchReveal = async () => {
    batchReveal = await batchRevealCF.deploy()
    await batchReveal.initialize()
  }

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
      config.amountForAllowlist,
      config.amountForDevs
    )
    await batchReveal.configure(
      launchpeg.address,
      config.batchRevealSize,
      config.batchRevealStart,
      config.batchRevealInterval
    )
    await launchpeg.setBatchReveal(batchReveal.address)
  }

  beforeEach(async () => {
    config = await getDefaultLaunchpegConfig()
    await deployBatchReveal()
    await deployLaunchpeg()
  })

  describe('Initialize Launchpeg', () => {
    it('Should allow owner to initialize only once', async () => {
      expect(await launchpeg.collectionSize()).to.eq(config.collectionSize)
      expect(await launchpeg.amountForDevs()).to.eq(config.amountForDevs)
      expect(await launchpeg.amountForAllowlist()).to.eq(config.amountForAllowlist)
      expect(await launchpeg.maxBatchSize()).to.eq(config.maxBatchSize)
      expect(await launchpeg.maxPerAddressDuringMint()).to.eq(config.maxBatchSize)

      await expect(
        launchpeg.initialize(
          'JoePEG',
          'JOEPEG',
          projectOwner.address,
          royaltyReceiver.address,
          config.maxBatchSize,
          config.collectionSize,
          config.amountForAuction,
          config.amountForAllowlist,
          config.amountForDevs
        )
      ).to.be.revertedWith('Initializable: contract is already initialized')
    })

    it('Should revert if project owner is zero address', async () => {
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
          config.amountForAllowlist,
          config.amountForDevs
        )
      ).to.be.revertedWith('Launchpeg__InvalidProjectOwner()')
    })

    it('Should revert if collection size is 0', async () => {
      config.collectionSize = 0
      await expect(deployLaunchpeg()).to.be.revertedWith('Launchpeg__LargerCollectionSizeNeeded()')
    })

    it('Should revert if dev and allowlist amounts are larger than collection size', async () => {
      config.amountForDevs = 10
      config.amountForAllowlist = 91
      config.collectionSize = 100
      await expect(deployLaunchpeg()).to.be.revertedWith('Launchpeg__LargerCollectionSizeNeeded()')
    })

    it('Should revert if max batch size is larger than collection size', async () => {
      config.maxBatchSize = config.collectionSize * 2
      await expect(deployLaunchpeg()).to.be.revertedWith('Launchpeg__InvalidMaxBatchSize()')
    })
  })

  describe('Configure Launchpeg', () => {
    it('Should allow owner to initialize fee configuration only once', async () => {
      const feePercent = 200
      const feeCollector = bob.address

      await expect(launchpeg.connect(alice).initializeJoeFee(feePercent, feeCollector)).to.be.revertedWith(
        'PendingOwnableUpgradeable__NotOwner()'
      )

      await launchpeg.initializeJoeFee(feePercent, feeCollector)
      expect(await launchpeg.joeFeePercent()).to.eq(feePercent)
      expect(await launchpeg.joeFeeCollector()).to.eq(feeCollector)

      await expect(launchpeg.initializeJoeFee(feePercent, feeCollector)).to.be.revertedWith(
        'Launchpeg__JoeFeeAlreadyInitialized()'
      )
    })

    it('Should revert if fee percent is invalid', async () => {
      const feePercent = 10001
      const feeCollector = bob.address
      await expect(launchpeg.initializeJoeFee(feePercent, feeCollector)).to.be.revertedWith(
        'Launchpeg__InvalidPercent()'
      )
    })

    it('Should revert if fee collector is zero address', async () => {
      let feePercent = 100
      let feeCollector = ethers.constants.AddressZero
      await expect(launchpeg.initializeJoeFee(feePercent, feeCollector)).to.be.revertedWith(
        'Launchpeg__InvalidJoeFeeCollector()'
      )
    })

    it('Should allow owner to set royalty info', async () => {
      const royaltyPercent = 500
      const royaltyCollector = bob

      await expect(
        launchpeg.connect(alice).setRoyaltyInfo(royaltyCollector.address, royaltyPercent)
      ).to.be.revertedWith('PendingOwnableUpgradeable__NotOwner()')

      await launchpeg.setRoyaltyInfo(royaltyCollector.address, royaltyPercent)

      const price = ethers.utils.parseEther('1')
      expect((await launchpeg.royaltyInfo(1, price))[1]).to.eq(price.mul(royaltyPercent).div(10_000))
    })

    it('Should revert if royalty fee percent is invalid', async () => {
      const royaltyPercent = 3_000
      const royaltyCollector = bob
      await expect(launchpeg.setRoyaltyInfo(royaltyCollector.address, royaltyPercent)).to.be.revertedWith(
        'Launchpeg__InvalidRoyaltyInfo()'
      )
    })

    it('Should allow owner to seed allowlist', async () => {
      const addresses = [alice.address, bob.address]
      const numNfts = [5, 10]

      await expect(launchpeg.connect(alice).seedAllowlist(addresses, numNfts)).to.be.revertedWith(
        'PendingOwnableUpgradeable__NotOwner()'
      )

      await launchpeg.seedAllowlist(addresses, numNfts)
      expect(await launchpeg.allowlist(addresses[0])).to.eq(numNfts[0])
      expect(await launchpeg.allowlist(addresses[0])).to.eq(numNfts[0])

      await expect(launchpeg.seedAllowlist([alice.address], numNfts)).to.be.revertedWith(
        'Launchpeg__WrongAddressesAndNumSlotsLength()'
      )
    })

    it('Should allow owner to set base URI', async () => {
      await expect(launchpeg.connect(alice).setBaseURI(config.baseTokenURI)).to.be.revertedWith(
        'PendingOwnableUpgradeable__NotOwner()'
      )

      await launchpeg.setBaseURI(config.baseTokenURI)
      expect(await launchpeg.baseURI()).to.eq(config.baseTokenURI)
    })

    it('Should allow owner to set unrevealed URI', async () => {
      await expect(launchpeg.connect(alice).setUnrevealedURI(config.unrevealedTokenURI)).to.be.revertedWith(
        'PendingOwnableUpgradeable__NotOwner()'
      )

      await launchpeg.setUnrevealedURI(config.unrevealedTokenURI)
      expect(await launchpeg.unrevealedURI()).to.eq(config.unrevealedTokenURI)
    })

    it('Should allow owner to set batch reveal address', async () => {
      await expect(launchpeg.connect(alice).setBatchReveal(batchReveal.address)).to.be.revertedWith(
        'PendingOwnableUpgradeable__NotOwner()'
      )

      await launchpeg.setBatchReveal(batchReveal.address)
    })
  })

  describe('Configure Launchpeg times', () => {
    beforeEach(async () => {
      await initializePhasesLaunchpeg(launchpeg, config, Phase.NotStarted)
    })

    it('Should allow owner to set allowlist start time', async () => {
      const newAllowlistStartTime = config.allowlistStartTime.sub(duration.minutes(30))
      await expect(launchpeg.connect(projectOwner).setAllowlistStartTime(newAllowlistStartTime)).to.be.revertedWith(
        'PendingOwnableUpgradeable__NotOwner()'
      )

      await launchpeg.setAllowlistStartTime(newAllowlistStartTime)
      expect(await launchpeg.allowlistStartTime()).to.eq(newAllowlistStartTime)
    })

    it('Should revert if allowlist is before pre-mint or after public sale', async () => {
      let invalidAllowlistStartTime = config.preMintStartTime.sub(duration.minutes(30))
      await expect(launchpeg.setAllowlistStartTime(invalidAllowlistStartTime)).to.be.revertedWith(
        'Launchpeg__AllowlistBeforePreMint()'
      )

      invalidAllowlistStartTime = config.publicSaleStartTime.add(duration.minutes(30))
      await expect(launchpeg.setAllowlistStartTime(invalidAllowlistStartTime)).to.be.revertedWith(
        'Launchpeg__PublicSaleBeforeAllowlist()'
      )
    })

    it('Should allow owner to set public sale start time', async () => {
      const newPublicSaleStartTime = config.publicSaleStartTime.sub(duration.minutes(30))
      await expect(launchpeg.connect(projectOwner).setPublicSaleStartTime(newPublicSaleStartTime)).to.be.revertedWith(
        'PendingOwnableUpgradeable__NotOwner()'
      )

      await launchpeg.setPublicSaleStartTime(newPublicSaleStartTime)
      expect(await launchpeg.publicSaleStartTime()).to.eq(newPublicSaleStartTime)
    })

    it('Should revert if public sale start is before allowlist or after public sale end', async () => {
      let invalidPublicSaleStartTime = config.allowlistStartTime.sub(duration.minutes(30))
      await expect(launchpeg.setPublicSaleStartTime(invalidPublicSaleStartTime)).to.be.revertedWith(
        'Launchpeg__PublicSaleBeforeAllowlist()'
      )
      invalidPublicSaleStartTime = config.publicSaleEndTime.add(duration.minutes(30))
      await expect(launchpeg.setPublicSaleStartTime(invalidPublicSaleStartTime)).to.be.revertedWith(
        'Launchpeg__PublicSaleEndBeforePublicSaleStart()'
      )
    })

    it('Should allow owner to set public sale end time', async () => {
      const newPublicSaleEndTime = config.publicSaleEndTime.sub(duration.minutes(30))
      await expect(launchpeg.connect(projectOwner).setPublicSaleEndTime(newPublicSaleEndTime)).to.be.revertedWith(
        'PendingOwnableUpgradeable__NotOwner()'
      )

      await launchpeg.setPublicSaleEndTime(newPublicSaleEndTime)
      expect(await launchpeg.publicSaleEndTime()).to.eq(newPublicSaleEndTime)
    })

    it('Should revert if public sale end is before public sale start', async () => {
      const invalidPublicSaleEndTime = config.publicSaleStartTime.sub(duration.minutes(30))
      await expect(launchpeg.setPublicSaleEndTime(invalidPublicSaleEndTime)).to.be.revertedWith(
        'Launchpeg__PublicSaleEndBeforePublicSaleStart()'
      )
    })

    it('Should revert when setting phase times before phases are initialized', async () => {
      const newAllowlistStartTime = config.allowlistStartTime.sub(duration.minutes(30))
      const newPublicSaleStartTime = config.publicSaleStartTime.sub(duration.minutes(30))
      const newPublicSaleEndTime = config.publicSaleEndTime.sub(duration.minutes(30))

      await deployLaunchpeg()

      await expect(launchpeg.setAllowlistStartTime(newAllowlistStartTime)).to.be.revertedWith(
        'Launchpeg__NotInitialized()'
      )
      await expect(launchpeg.setPublicSaleStartTime(newPublicSaleStartTime)).to.be.revertedWith(
        'Launchpeg__NotInitialized()'
      )
      await expect(launchpeg.setPublicSaleEndTime(newPublicSaleEndTime)).to.be.revertedWith(
        'Launchpeg__NotInitialized()'
      )
    })

    it('Should allow owner to set withdraw AVAX start time', async () => {
      const blockTimestamp = await latest()
      const newWithdrawAVAXStartTime = blockTimestamp.add(duration.hours(1))
      await expect(
        launchpeg.connect(projectOwner).setWithdrawAVAXStartTime(newWithdrawAVAXStartTime)
      ).to.be.revertedWith('PendingOwnableUpgradeable__NotOwner()')

      await launchpeg.setWithdrawAVAXStartTime(newWithdrawAVAXStartTime)
      expect(await launchpeg.withdrawAVAXStartTime()).to.eq(newWithdrawAVAXStartTime)
    })

    it('Should revert if withdraw AVAX start time is before current block timestamp', async () => {
      const blockTimestamp = await latest()
      await expect(launchpeg.setWithdrawAVAXStartTime(blockTimestamp.sub(duration.minutes(1)))).to.be.revertedWith(
        'Launchpeg__InvalidStartTime()'
      )
    })
  })

  describe('Project owner mint', () => {
    it('Should allow dev to mint up to dev amount', async () => {
      await expect(launchpeg.connect(alice).devMint(1)).to.be.revertedWith(
        'SafeAccessControlEnumerableUpgradeable__SenderMissingRoleAndIsNotOwner'
      )

      await launchpeg.connect(projectOwner).devMint(config.maxBatchSize)

      // mint amount that is not a multiple of max batch size
      await launchpeg.connect(projectOwner).devMint(config.amountForDevs - config.maxBatchSize - 1)
      await launchpeg.connect(projectOwner).devMint(1)
      expect(await launchpeg.balanceOf(projectOwner.address)).to.eq(config.amountForDevs)

      await expect(launchpeg.connect(projectOwner).devMint(1)).to.be.revertedWith('Launchpeg__MaxSupplyForDevReached()')
    })

    it('Should revert if dev mint exceeds collection size', async () => {
      config.collectionSize = 50
      config.amountForDevs = 50
      config.amountForAuction = 0
      config.amountForAllowlist = 0
      config.batchRevealSize = 10
      await deployLaunchpeg()
      await initializePhasesLaunchpeg(launchpeg, config, Phase.Allowlist)

      await launchpeg.connect(projectOwner).devMint(config.amountForDevs)
      await expect(launchpeg.connect(projectOwner).devMint(1)).to.be.revertedWith('Launchpeg__MaxSupplyReached()')
    })

    it('Should revert if dev mint exceeds dev amount', async () => {
      config.collectionSize = 100
      config.amountForDevs = 50
      config.amountForAuction = 0
      config.amountForAllowlist = 0
      config.batchRevealSize = 10
      await deployLaunchpeg()
      await initializePhasesLaunchpeg(launchpeg, config, Phase.Allowlist)

      await launchpeg.connect(projectOwner).devMint(config.amountForDevs)
      await expect(launchpeg.connect(projectOwner).devMint(1)).to.be.revertedWith('Launchpeg__MaxSupplyForDevReached()')
    })

    it('Should allow user with project owner role to mint', async () => {
      await launchpeg.connect(dev).grantRole(launchpeg.PROJECT_OWNER_ROLE(), alice.address)
      await launchpeg.connect(alice).devMint(config.amountForDevs)
      expect(await launchpeg.balanceOf(alice.address)).to.eq(config.amountForDevs)
    })
  })

  describe('Pre-mint phase', () => {
    let allowlistPrice: BigNumber

    beforeEach(async () => {
      await initializePhasesLaunchpeg(launchpeg, config, Phase.PreMint)
      await launchpeg.connect(dev).seedAllowlist([alice.address], [5])

      const discount = config.startPrice.mul(config.allowlistDiscount).div(10000)
      allowlistPrice = config.startPrice.sub(discount)
    })

    it('Should allow whitelisted user to pre-mint', async () => {
      const quantity = 1
      await launchpeg.connect(alice).preMint(quantity, { value: allowlistPrice.mul(quantity) })
      expect(await launchpeg.amountMintedDuringPreMint()).to.eq(quantity)
      expect(await launchpeg.numberMinted(alice.address)).to.eq(0)
      expect(await launchpeg.numberMintedWithPreMint(alice.address)).to.eq(quantity)
      expect(await launchpeg.userAddressToPreMintAmount(alice.address)).to.eq(quantity)

      await expect(launchpeg.connect(bob).preMint(1, { value: allowlistPrice })).to.be.revertedWith(
        'Launchpeg__NotEligibleForAllowlistMint'
      )
    })

    it('Should receive allowlist price per NFT', async () => {
      const quantity = 2
      await launchpeg.connect(alice).preMint(quantity, { value: allowlistPrice.mul(quantity) })
      expect(await launchpeg.userAddressToPreMintAmount(alice.address)).to.eq(quantity)

      await expect(launchpeg.connect(alice).preMint(1)).to.be.revertedWith('Launchpeg__NotEnoughAVAX(0)')
    })

    it('Should allow user to pre-mint up to allowlist allocation', async () => {
      const allowlistQty = await launchpeg.allowlist(alice.address)
      const quantity = 3
      const remQuantity = allowlistQty - quantity
      await launchpeg.connect(alice).preMint(quantity, { value: allowlistPrice.mul(quantity) })
      expect(await launchpeg.userAddressToPreMintAmount(alice.address)).to.eq(quantity)
      expect(await launchpeg.allowlist(alice.address)).to.eq(remQuantity)

      await expect(
        launchpeg.connect(alice).preMint(remQuantity + 1, { value: allowlistPrice.mul(remQuantity + 1) })
      ).to.be.revertedWith('Launchpeg__NotEligibleForAllowlistMint()')

      await launchpeg.connect(alice).preMint(remQuantity, { value: allowlistPrice.mul(remQuantity) })
      expect(await launchpeg.userAddressToPreMintAmount(alice.address)).to.eq(quantity + remQuantity)
    })

    it('Should revert when pre-mint quantity is 0', async () => {
      await expect(launchpeg.connect(alice).preMint(0)).to.be.revertedWith('Launchpeg__InvalidQuantity()')
    })

    it('Should not transfer pre-minted NFT to user', async () => {
      await launchpeg.connect(alice).preMint(1, { value: allowlistPrice })
      expect(await launchpeg.userAddressToPreMintAmount(alice.address)).to.eq(1)
      expect(await launchpeg.balanceOf(alice.address)).to.eq(0)
    })

    it('Should allow users to pre-mint up to allowlist amount', async () => {
      config = await getDefaultLaunchpegConfig()
      config.amountForAllowlist = 5
      await deployLaunchpeg()
      await initializePhasesLaunchpeg(launchpeg, config, Phase.PreMint)
      await launchpeg.connect(dev).seedAllowlist([alice.address, bob.address], [5, 4])

      const aliceQty = 4
      const bobQty = 1
      await launchpeg.connect(alice).preMint(aliceQty, { value: allowlistPrice.mul(aliceQty) })
      await launchpeg.connect(bob).preMint(bobQty, { value: allowlistPrice.mul(bobQty) })

      await expect(launchpeg.connect(bob).preMint(bobQty, { value: allowlistPrice.mul(bobQty) })).to.be.revertedWith(
        'Launchpeg__MaxSupplyReached()'
      )

      expect(await launchpeg.userAddressToPreMintAmount(alice.address)).to.eq(aliceQty)
      expect(await launchpeg.userAddressToPreMintAmount(bob.address)).to.eq(bobQty)
      expect(await launchpeg.amountMintedDuringPreMint()).to.eq(aliceQty + bobQty)
    })

    it('Should not allow batch mint during pre-mint phase', async () => {
      await launchpeg.connect(alice).preMint(1, { value: allowlistPrice })
      await expect(launchpeg.connect(bob).batchMintPreMintedNFTs(1)).to.be.revertedWith('Launchpeg__WrongPhase()')
    })
  })

  describe('Allowlist phase', async () => {
    let allowlistPrice: BigNumber

    beforeEach(async () => {
      const discount = config.startPrice.mul(config.allowlistDiscount).div(10000)
      allowlistPrice = config.startPrice.sub(discount)
    })

    it('Should allow whitelisted user to pre-mint and allowlist mint up to allowlist amount', async () => {
      await initializePhasesLaunchpeg(launchpeg, config, Phase.PreMint)
      await launchpeg.connect(dev).seedAllowlist([alice.address], [10])

      // Alice pre-mints
      const preMintQty = 5
      const allowlistMintQty = 5
      await launchpeg.connect(alice).preMint(preMintQty, { value: allowlistPrice.mul(preMintQty) })

      // Advance to allowlist phase
      const blockTimestamp = await latest()
      await advanceTimeAndBlock(duration.seconds(config.allowlistStartTime.sub(blockTimestamp).toNumber()))
      expect(await launchpeg.allowlist(alice.address)).to.eq(allowlistMintQty)

      // Alice allowlist mints
      await launchpeg.connect(alice).allowlistMint(allowlistMintQty, { value: allowlistPrice.mul(allowlistMintQty) })
      expect(await launchpeg.allowlist(alice.address)).to.eq(0)
      expect(await launchpeg.numberMinted(alice.address)).to.eq(allowlistMintQty)
      expect(await launchpeg.numberMintedWithPreMint(alice.address)).to.eq(allowlistMintQty + preMintQty)

      await expect(launchpeg.connect(alice).allowlistMint(1, { value: allowlistPrice })).to.be.revertedWith(
        'Launchpeg__NotEligibleForAllowlistMint()'
      )
    })

    it('Should allow any user to batch mint', async () => {
      await initializePhasesLaunchpeg(launchpeg, config, Phase.PreMint)
      await launchpeg.connect(dev).seedAllowlist([alice.address, bob.address], [10, 5])

      // Alice and Bob pre-mint
      const alicePreMintQty = 10
      const bobPreMintQty = 5
      await launchpeg.connect(alice).preMint(alicePreMintQty, { value: allowlistPrice.mul(alicePreMintQty) })
      await launchpeg.connect(bob).preMint(bobPreMintQty, { value: allowlistPrice.mul(alicePreMintQty) })

      // Advance to allowlist phase
      const blockTimestamp = await latest()
      await advanceTimeAndBlock(duration.seconds(config.allowlistStartTime.sub(blockTimestamp).toNumber()))
      expect(await launchpeg.balanceOf(alice.address)).to.eq(0)
      expect(await launchpeg.balanceOf(bob.address)).to.eq(0)

      // Bob batch mints
      await launchpeg.connect(bob).batchMintPreMintedNFTs(5)
      expect(await launchpeg.balanceOf(alice.address)).to.eq(5)
      expect(await launchpeg.balanceOf(bob.address)).to.eq(0)

      // Alice batch mints (more than available in queue)
      await launchpeg.connect(alice).batchMintPreMintedNFTs(20)
      expect(await launchpeg.balanceOf(alice.address)).to.eq(10)
      expect(await launchpeg.balanceOf(bob.address)).to.eq(5)
      expect(await launchpeg.amountBatchMinted()).to.eq(15)
      expect(await launchpeg.userAddressToPreMintAmount(alice.address)).to.eq(0)
      expect(await launchpeg.userAddressToPreMintAmount(bob.address)).to.eq(0)
      expect(await launchpeg.numberMinted(bob.address)).to.eq(5)
      expect(await launchpeg.numberMintedWithPreMint(bob.address)).to.eq(5)

      await expect(launchpeg.batchMintPreMintedNFTs(5)).to.be.revertedWith('Launchpeg__MaxSupplyForBatchMintReached()')
    })

    it('Should revert when there are no NFTs to batch mint', async () => {
      await initializePhasesLaunchpeg(launchpeg, config, Phase.Allowlist)
      await expect(launchpeg.batchMintPreMintedNFTs(0)).to.be.revertedWith('Launchpeg__InvalidQuantity()')
      await expect(launchpeg.batchMintPreMintedNFTs(5)).to.be.revertedWith('Launchpeg__MaxSupplyForBatchMintReached()')
    })
  })

  describe('Public sale phase', () => {
    let allowlistPrice: BigNumber

    beforeEach(async () => {
      const discount = config.startPrice.mul(config.allowlistDiscount).div(10000)
      allowlistPrice = config.startPrice.sub(discount)
    })

    it('Should allow any user to batch mint', async () => {
      await initializePhasesLaunchpeg(launchpeg, config, Phase.PreMint)
      await launchpeg.connect(dev).seedAllowlist([alice.address], [5])

      // Alice pre-mints
      const preMintQty = 2
      await launchpeg.connect(alice).preMint(preMintQty, { value: allowlistPrice.mul(preMintQty) })

      // Advance to public sale phase
      const blockTimestamp = await latest()
      await advanceTimeAndBlock(duration.seconds(config.publicSaleStartTime.sub(blockTimestamp).toNumber()))
      expect(await launchpeg.balanceOf(alice.address)).to.eq(0)

      // Bob batch mints
      await launchpeg.connect(bob).batchMintPreMintedNFTs(preMintQty)
      expect(await launchpeg.balanceOf(alice.address)).to.eq(preMintQty)
      expect(await launchpeg.amountBatchMinted()).to.eq(preMintQty)
      expect(await launchpeg.userAddressToPreMintAmount(alice.address)).to.eq(0)
      expect(await launchpeg.numberMinted(alice.address)).to.eq(preMintQty)
      expect(await launchpeg.numberMintedWithPreMint(alice.address)).to.eq(preMintQty)

      await expect(launchpeg.batchMintPreMintedNFTs(5)).to.be.revertedWith('Launchpeg__MaxSupplyForBatchMintReached()')
    })

    it('Should not allow batch mint after public sale', async () => {
      await initializePhasesLaunchpeg(launchpeg, config, Phase.Ended)
      await expect(launchpeg.batchMintPreMintedNFTs(5)).to.be.revertedWith('Launchpeg__WrongPhase()')
    })
  })

  describe('Funds flow', () => {
    let publicSalePrice: BigNumber

    beforeEach(async () => {
      await initializePhasesLaunchpeg(launchpeg, config, Phase.PublicSale)
      const discount = config.startPrice.mul(config.publicSaleDiscount).div(10000)
      publicSalePrice = config.startPrice.sub(discount)
    })

    it('Should allow owner to withdraw funds', async () => {
      await expect(launchpeg.connect(alice).withdrawAVAX(alice.address)).to.be.revertedWith(
        'SafeAccessControlEnumerableUpgradeable__SenderMissingRoleAndIsNotOwner'
      )

      await launchpeg.connect(alice).publicSaleMint(5, { value: publicSalePrice.mul(5) })
      await launchpeg.connect(bob).publicSaleMint(4, { value: publicSalePrice.mul(4) })

      const initialDevBalance = await dev.getBalance()
      await launchpeg.connect(dev).withdrawAVAX(dev.address)
      expect(await dev.getBalance()).to.be.closeTo(
        initialDevBalance.add(publicSalePrice.mul(9)),
        ethers.utils.parseEther('0.01')
      )
    })

    it('Should allow project owner to withdraw funds', async () => {
      await launchpeg.connect(alice).publicSaleMint(5, { value: publicSalePrice.mul(5) })
      await launchpeg.connect(bob).publicSaleMint(4, { value: publicSalePrice.mul(4) })

      const initialBalance = await projectOwner.getBalance()
      await launchpeg.connect(projectOwner).withdrawAVAX(projectOwner.address)
      expect(await projectOwner.getBalance()).to.be.closeTo(
        initialBalance.add(publicSalePrice.mul(9)),
        ethers.utils.parseEther('0.01')
      )
    })

    it('Should revert if project owner withdraws funds before withdraw start time', async () => {
      const blockTimestamp = await latest()
      await launchpeg.setWithdrawAVAXStartTime(blockTimestamp.add(duration.hours(1)))

      await expect(launchpeg.connect(projectOwner).withdrawAVAX(projectOwner.address)).to.be.revertedWith(
        'Launchpeg__WithdrawAVAXNotAvailable()'
      )
    })

    it('Should revert if project owner withdraws funds before withdraw start time is initialized', async () => {
      await deployLaunchpeg()
      await expect(launchpeg.connect(projectOwner).withdrawAVAX(projectOwner.address)).to.be.revertedWith(
        'Launchpeg__WithdrawAVAXNotAvailable()'
      )
    })

    it('Should send fee correctly to fee collector address', async () => {
      const feePercent = 200
      const feeCollector = bob
      await launchpeg.initializeJoeFee(feePercent, feeCollector.address)

      const total = publicSalePrice.mul(5)
      await launchpeg.connect(alice).publicSaleMint(5, { value: total })

      const fee = total.mul(feePercent).div(10000)
      const initialDevBalance = await dev.getBalance()
      const initialFeeCollectorBalance = await feeCollector.getBalance()
      await launchpeg.connect(dev).withdrawAVAX(dev.address)
      expect(await dev.getBalance()).to.be.closeTo(
        initialDevBalance.add(total.sub(fee)),
        ethers.utils.parseEther('0.01')
      )
      expect(await feeCollector.getBalance()).to.eq(initialFeeCollectorBalance.add(fee))
    })
  })

  describe('Batch reveal disabled', () => {
    beforeEach(async () => {
      await launchpeg.setBatchReveal(ethers.constants.AddressZero)
    })

    it('Should reveal NFTs immediately', async () => {
      const tokenId = 0
      const expTokenURI = `${config.baseTokenURI}${tokenId}`
      config.batchRevealSize = 0
      await launchpeg.setBaseURI(config.baseTokenURI)
      expect(await launchpeg.tokenURI(tokenId)).to.eq(expTokenURI)
    })

    it('Should revert when user reveals next batch', async () => {
      await expect(launchpeg.revealNextBatch()).to.be.revertedWith('Launchpeg__BatchRevealDisabled()')
    })

    it('Should return false when user checks if there is a batch to reveal', async () => {
      const hasBatchToReveal = await launchpeg.hasBatchToReveal()
      expect(hasBatchToReveal[0]).to.eq(false)
      expect(hasBatchToReveal[1]).to.eq(0)
    })
  })

  describe('Batch reveal during mint', () => {
    it('Should not reveal NFTs initially', async () => {
      await initializePhasesLaunchpeg(launchpeg, config, Phase.NotStarted)
      expect(await launchpeg.tokenURI(0)).to.eq(config.unrevealedTokenURI)
    })

    it('Should reveal first NFTs gradually', async () => {
      config.collectionSize = 50
      config.amountForDevs = 50
      config.amountForAuction = 0
      config.amountForAllowlist = 0
      config.batchRevealSize = 10
      config.batchRevealStart = BigNumber.from(0)
      config.batchRevealInterval = BigNumber.from(0)
      await deployLaunchpeg()
      await initializePhasesLaunchpeg(launchpeg, config, Phase.Allowlist)

      // Project owner mints 1st batch
      await launchpeg.connect(projectOwner).devMint(config.batchRevealSize)

      expect((await launchpeg.hasBatchToReveal())[0]).to.eq(true)
      await launchpeg.connect(alice).revealNextBatch()
      expect((await launchpeg.hasBatchToReveal())[0]).to.eq(false)
      expect(await launchpeg.tokenURI(0)).to.contains(config.baseTokenURI)
      expect(await launchpeg.tokenURI(config.batchRevealSize)).to.eq(config.unrevealedTokenURI)

      // Project owner mints 2nd batch
      await launchpeg.connect(projectOwner).devMint(config.batchRevealSize)

      expect((await launchpeg.hasBatchToReveal())[1]).to.eq(BigNumber.from(1))
      await launchpeg.connect(bob).revealNextBatch()
      expect(await launchpeg.tokenURI(2 * config.batchRevealSize - 1)).to.contains(config.baseTokenURI)
      expect(await launchpeg.tokenURI(2 * config.batchRevealSize + 1)).to.eq(config.unrevealedTokenURI)

      // Mint the rest of the collection
      for (let i = 0; i < 3; i++) {
        await launchpeg.connect(projectOwner).devMint(config.batchRevealSize)
        await launchpeg.connect(bob).revealNextBatch()
      }
      expect(await launchpeg.tokenURI(config.collectionSize - 1)).to.contains(config.baseTokenURI)
    })

    it('Should revert when user reveals next batch too early', async () => {
      config.collectionSize = 50
      config.amountForDevs = 50
      config.amountForAuction = 0
      config.amountForAllowlist = 0
      config.batchRevealSize = 10
      config.batchRevealStart = BigNumber.from(0)
      config.batchRevealInterval = BigNumber.from(0)
      await deployLaunchpeg()
      await initializePhasesLaunchpeg(launchpeg, config, Phase.Allowlist)

      await expect(launchpeg.connect(alice).revealNextBatch()).to.be.revertedWith(
        'Launchpeg__RevealNextBatchNotAvailable'
      )

      await launchpeg.connect(projectOwner).devMint(config.batchRevealSize)
      await launchpeg.connect(bob).revealNextBatch()
      await expect(launchpeg.connect(alice).revealNextBatch()).to.be.revertedWith(
        'Launchpeg__RevealNextBatchNotAvailable'
      )
    })
  })

  describe('Batch reveal after sale', () => {
    it('Should not reveal first NFTs during sale (before reveal start time)', async () => {
      config.collectionSize = 50
      config.amountForDevs = 50
      config.amountForAuction = 0
      config.amountForAllowlist = 0
      config.batchRevealSize = 10
      await deployLaunchpeg()
      await initializePhasesLaunchpeg(launchpeg, config, Phase.Allowlist)

      // Project owner mints 1st batch
      await launchpeg.connect(projectOwner).devMint(config.batchRevealSize)

      expect(await launchpeg.tokenURI(0)).to.eq(config.unrevealedTokenURI)
      await expect(launchpeg.connect(alice).revealNextBatch()).to.be.revertedWith(
        'Launchpeg__RevealNextBatchNotAvailable'
      )

      // Project owner mints 2nd batch
      await launchpeg.connect(projectOwner).devMint(config.batchRevealSize)

      expect(await launchpeg.tokenURI(2 * config.batchRevealSize - 1)).to.eq(config.unrevealedTokenURI)
      await expect(launchpeg.connect(alice).revealNextBatch()).to.be.revertedWith(
        'Launchpeg__RevealNextBatchNotAvailable'
      )
    })

    it('Should gradually reveal NFTs after reveal start time', async () => {
      config.collectionSize = 50
      config.amountForDevs = 50
      config.amountForAuction = 0
      config.amountForAllowlist = 0
      config.batchRevealSize = 10
      await deployLaunchpeg()
      await initializePhasesLaunchpeg(launchpeg, config, Phase.Reveal)

      await launchpeg.connect(projectOwner).devMint(3 * config.batchRevealSize)

      await launchpeg.connect(alice).revealNextBatch()
      expect(await launchpeg.tokenURI(0)).to.contains(config.baseTokenURI)
      expect(await launchpeg.tokenURI(config.batchRevealSize)).to.eq(config.unrevealedTokenURI)

      // Too early to reveal next batch
      await expect(launchpeg.connect(bob).revealNextBatch()).to.be.revertedWith(
        'Launchpeg__RevealNextBatchNotAvailable'
      )
      await advanceTimeAndBlock(config.batchRevealInterval)

      await launchpeg.connect(bob).revealNextBatch()
      expect(await launchpeg.tokenURI(2 * config.batchRevealSize - 1)).to.contains(config.baseTokenURI)
      expect(await launchpeg.tokenURI(2 * config.batchRevealSize + 1)).to.eq(config.unrevealedTokenURI)
    })
  })

  describe('Pause Launchpeg methods', () => {
    let PAUSER_ROLE: Bytes
    let UNPAUSER_ROLE: Bytes

    beforeEach(async () => {
      PAUSER_ROLE = await launchpeg.PAUSER_ROLE()
      UNPAUSER_ROLE = await launchpeg.UNPAUSER_ROLE()
    })

    it('Should allow owner to pause and unpause', async () => {
      await launchpeg.pause()
      expect(await launchpeg.paused()).to.eq(true)

      await launchpeg.unpause()
      expect(await launchpeg.paused()).to.eq(false)
    })

    it('Should allow user with PAUSER_ROLE to pause and UNPAUSER_ROLE to unpause', async () => {
      await expect(launchpeg.connect(alice).pause()).to.be.revertedWith(
        'SafeAccessControlEnumerableUpgradeable__SenderMissingRoleAndIsNotOwner'
      )
      await launchpeg.grantRole(PAUSER_ROLE, alice.address)
      await launchpeg.connect(alice).pause()
      expect(await launchpeg.paused()).to.eq(true)

      await expect(launchpeg.connect(alice).unpause()).to.be.revertedWith(
        'SafeAccessControlEnumerableUpgradeable__SenderMissingRoleAndIsNotOwner'
      )
      await launchpeg.grantRole(UNPAUSER_ROLE, alice.address)
      await launchpeg.connect(alice).unpause()
      expect(await launchpeg.paused()).to.eq(false)
    })

    it('Should allow owner to grant and revoke PAUSER_ROLE and UNPAUSER_ROLE', async () => {
      await launchpeg.grantRole(PAUSER_ROLE, alice.address)
      await launchpeg.connect(alice).pause()
      await launchpeg.revokeRole(PAUSER_ROLE, alice.address)
      await expect(launchpeg.connect(alice).pause()).to.be.revertedWith(
        'SafeAccessControlEnumerableUpgradeable__SenderMissingRoleAndIsNotOwner'
      )

      await launchpeg.grantRole(UNPAUSER_ROLE, alice.address)
      await launchpeg.connect(alice).unpause()
      await launchpeg.revokeRole(UNPAUSER_ROLE, alice.address)
      await expect(launchpeg.connect(alice).unpause()).to.be.revertedWith(
        'SafeAccessControlEnumerableUpgradeable__SenderMissingRoleAndIsNotOwner'
      )
    })

    it('Should not allow non-owner to grant PAUSER_ROLE and UNPAUSER_ROLE', async () => {
      await expect(launchpeg.connect(projectOwner).grantRole(PAUSER_ROLE, alice.address)).to.be.revertedWith(
        'SafeAccessControlEnumerableUpgradeable__SenderMissingRoleAndIsNotOwner'
      )
      await expect(launchpeg.connect(projectOwner).grantRole(UNPAUSER_ROLE, alice.address)).to.be.revertedWith(
        'SafeAccessControlEnumerableUpgradeable__SenderMissingRoleAndIsNotOwner'
      )
    })

    it('Should not allow non-owner to revoke PAUSER_ROLE and UNPAUSER_ROLE', async () => {
      await launchpeg.grantRole(PAUSER_ROLE, alice.address)
      await expect(launchpeg.connect(bob).revokeRole(PAUSER_ROLE, alice.address)).to.be.revertedWith(
        'SafeAccessControlEnumerableUpgradeable__SenderMissingRoleAndIsNotOwner'
      )
      await launchpeg.connect(alice).pause()

      await launchpeg.grantRole(UNPAUSER_ROLE, alice.address)
      await expect(launchpeg.connect(bob).revokeRole(UNPAUSER_ROLE, alice.address)).to.be.revertedWith(
        'SafeAccessControlEnumerableUpgradeable__SenderMissingRoleAndIsNotOwner'
      )
      await launchpeg.connect(alice).unpause()
    })

    it('Should allow owner or pauser to pause mint methods', async () => {
      await launchpeg.pause()
      await expect(launchpeg.connect(dev).devMint(1)).to.be.revertedWith('Pausable: paused')

      await launchpeg.unpause()
      await launchpeg.connect(dev).devMint(1)
    })

    it('Should allow owner or pauser to pause funds withdrawal', async () => {
      await initializePhasesLaunchpeg(launchpeg, config, Phase.PublicSale)
      await launchpeg.pause()
      await expect(launchpeg.connect(projectOwner).withdrawAVAX(alice.address)).to.be.revertedWith('Pausable: paused')

      await launchpeg.unpause()
      await launchpeg.connect(projectOwner).withdrawAVAX(alice.address)
    })

    it('Should allow owner or pauser to pause batch reveal', async () => {
      config.collectionSize = 50
      config.amountForDevs = 10
      config.amountForAuction = 0
      config.amountForAllowlist = 0
      config.batchRevealSize = 10
      await deployLaunchpeg()
      await initializePhasesLaunchpeg(launchpeg, config, Phase.Reveal)
      await launchpeg.devMint(10)

      await launchpeg.pause()
      await expect(launchpeg.connect(alice).revealNextBatch()).to.be.revertedWith('Pausable: paused')

      await launchpeg.unpause()
      await launchpeg.connect(alice).revealNextBatch()
    })
  })

  after(async () => {
    await network.provider.request({
      method: 'hardhat_reset',
      params: [],
    })
  })
})
