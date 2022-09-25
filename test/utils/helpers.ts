import { ethers } from 'hardhat'
import { BigNumber, Contract } from 'ethers'
import { duration, advanceTimeAndBlock, latest } from './time'

export interface LaunchpegConfig {
  auctionStartTime: BigNumber
  preMintStartTime: BigNumber
  allowlistStartTime: BigNumber
  publicSaleStartTime: BigNumber
  publicSaleEndTime: BigNumber
  maxBatchSize: number
  collectionSize: number
  amountForAuction: number
  amountForAllowlist: number
  amountForDevs: number
  startPrice: BigNumber
  endPrice: BigNumber
  auctionDropInterval: BigNumber
  allowlistDiscount: number
  publicSaleDiscount: number
  batchRevealSize: number
  batchRevealStart: BigNumber
  batchRevealInterval: BigNumber
  baseTokenURI: string
  unrevealedTokenURI: string
  flatPublicSalePrice: BigNumber
  flatAllowlistSalePrice: BigNumber
  withdrawAVAXStartTime: BigNumber
}

const WITHDRAW_AVAX_START_OFFSET = 1
const AUCTION_START_OFFSET = 10
const PREMINT_START_OFFSET = 100
const ALLOWLIST_START_OFFSET = 150
const PUBLIC_SALE_START_OFFSET = 200
const PUBLIC_SALE_END_OFFSET = 300
const REVEAL_START_OFFSET = 400
const REVEAL_INTERVAL = 50

export const getDefaultLaunchpegConfig = async (): Promise<LaunchpegConfig> => {
  const blockTimestamp = await latest()
  const auctionStartTime = blockTimestamp.add(duration.minutes(AUCTION_START_OFFSET))
  return {
    auctionStartTime,
    preMintStartTime: auctionStartTime.add(duration.minutes(PREMINT_START_OFFSET)),
    allowlistStartTime: auctionStartTime.add(duration.minutes(ALLOWLIST_START_OFFSET)),
    publicSaleStartTime: auctionStartTime.add(duration.minutes(PUBLIC_SALE_START_OFFSET)),
    publicSaleEndTime: auctionStartTime.add(duration.minutes(PUBLIC_SALE_END_OFFSET)),
    maxBatchSize: 5,
    collectionSize: 10000,
    amountForAuction: 8000,
    amountForAllowlist: 1900,
    amountForDevs: 100,
    startPrice: ethers.utils.parseUnits('1', 18),
    endPrice: ethers.utils.parseUnits('0.15', 18),
    auctionDropInterval: duration.minutes(20),
    allowlistDiscount: 0.1 * 10000,
    publicSaleDiscount: 0.2 * 10000,
    batchRevealSize: 1000,
    batchRevealStart: auctionStartTime.add(duration.minutes(REVEAL_START_OFFSET)),
    batchRevealInterval: duration.minutes(REVEAL_INTERVAL),
    baseTokenURI: 'ipfs://bafybeib3jkgtnqmnevrafzlrhroa6ws7wbmdh7dndonij7jvmvho5fmxj4/',
    unrevealedTokenURI: 'unrevealed',
    flatPublicSalePrice: ethers.utils.parseUnits('1', 18),
    flatAllowlistSalePrice: ethers.utils.parseUnits('0.5', 18),
    withdrawAVAXStartTime: blockTimestamp.add(duration.minutes(WITHDRAW_AVAX_START_OFFSET)),
  }
}

export enum Phase {
  NotStarted,
  DutchAuction,
  PreMint,
  Allowlist,
  PublicSale,
  Reveal,
  Ended,
}

export const initializePhasesLaunchpeg = async (launchpeg: Contract, config: LaunchpegConfig, currentPhase: Phase) => {
  await launchpeg.initializePhases(
    config.auctionStartTime,
    config.startPrice,
    config.endPrice,
    config.auctionDropInterval,
    config.preMintStartTime,
    config.allowlistStartTime,
    config.allowlistDiscount,
    config.publicSaleStartTime,
    config.publicSaleEndTime,
    config.publicSaleDiscount
  )
  await launchpeg.setUnrevealedURI(config.unrevealedTokenURI)
  await launchpeg.setBaseURI(config.baseTokenURI)
  await launchpeg.setWithdrawAVAXStartTime(config.withdrawAVAXStartTime)
  await advanceTimeAndBlockToPhase(currentPhase)
}

export const initializePhasesFlatLaunchpeg = async (
  flatLaunchpeg: Contract,
  config: LaunchpegConfig,
  currentPhase: Phase
) => {
  await flatLaunchpeg.initializePhases(
    config.preMintStartTime,
    config.allowlistStartTime,
    config.publicSaleStartTime,
    config.publicSaleEndTime,
    config.flatAllowlistSalePrice,
    config.flatPublicSalePrice
  )
  await flatLaunchpeg.setUnrevealedURI(config.unrevealedTokenURI)
  await flatLaunchpeg.setBaseURI(config.baseTokenURI)
  await flatLaunchpeg.setWithdrawAVAXStartTime(config.withdrawAVAXStartTime)
  await advanceTimeAndBlockToPhase(currentPhase)
}

const advanceTimeAndBlockToPhase = async (phase: Phase) => {
  switch (phase) {
    case Phase.NotStarted:
      break
    case Phase.DutchAuction:
      await advanceTimeAndBlock(duration.minutes(AUCTION_START_OFFSET))
      break
    case Phase.PreMint:
      await advanceTimeAndBlock(duration.minutes(PREMINT_START_OFFSET + AUCTION_START_OFFSET))
      break
    case Phase.Allowlist:
      await advanceTimeAndBlock(duration.minutes(ALLOWLIST_START_OFFSET + AUCTION_START_OFFSET))
      break
    case Phase.PublicSale:
      await advanceTimeAndBlock(duration.minutes(PUBLIC_SALE_START_OFFSET + AUCTION_START_OFFSET))
      break
    case Phase.Ended:
      await advanceTimeAndBlock(duration.minutes(PUBLIC_SALE_END_OFFSET + AUCTION_START_OFFSET))
      break
    case Phase.Reveal:
      await advanceTimeAndBlock(duration.minutes(REVEAL_START_OFFSET + AUCTION_START_OFFSET))
      break
  }
}
