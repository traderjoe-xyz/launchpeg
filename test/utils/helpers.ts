import { ethers } from 'hardhat'
import { BigNumber, Contract } from 'ethers'
import { duration, advanceTimeAndBlock, latest } from './time'

export interface LaunchPegConfig {
  auctionStartTime: BigNumber
  mintlistStartTime: BigNumber
  publicSaleStartTime: BigNumber
  maxBatchSize: number
  collectionSize: number
  amountForAuction: number
  amountForMintlist: number
  amountForDevs: number
  startPrice: BigNumber
  endPrice: BigNumber
  auctionDropInterval: BigNumber
  mintlistDiscount: number
  publicSaleDiscount: number
  batchRevealSize: number
  batchRevealStart: BigNumber
  batchRevealInterval: BigNumber
  baseTokenURI: string
  unrevealedTokenURI: string
}

const MINTLIST_START_OFFSET = 100
const PUBLIC_SALE_START_OFFSET = 200
const REVEAL_START_OFFSET = 400
const REVEAL_INTERVAL = 50

export const getDefaultLaunchPegConfig = async (): Promise<LaunchPegConfig> => {
  const auctionStartTime = await latest()
  return {
    auctionStartTime,
    mintlistStartTime: auctionStartTime.add(duration.minutes(MINTLIST_START_OFFSET)),
    publicSaleStartTime: auctionStartTime.add(duration.minutes(PUBLIC_SALE_START_OFFSET)),
    maxBatchSize: 5,
    collectionSize: 10000,
    amountForAuction: 8000,
    amountForMintlist: 1900,
    amountForDevs: 100,
    startPrice: ethers.utils.parseUnits('1', 18),
    endPrice: ethers.utils.parseUnits('0.15', 18),
    auctionDropInterval: duration.minutes(20),
    mintlistDiscount: 0.1 * 10000,
    publicSaleDiscount: 0.2 * 10000,
    batchRevealSize: 1000,
    batchRevealStart: auctionStartTime.add(duration.minutes(REVEAL_START_OFFSET)),
    batchRevealInterval: duration.minutes(REVEAL_INTERVAL),
    baseTokenURI: 'ipfs://bafybeib3jkgtnqmnevrafzlrhroa6ws7wbmdh7dndonij7jvmvho5fmxj4/',
    unrevealedTokenURI: 'unrevealed',
  }
}

export enum Phase {
  DutchAuction,
  Mintlist,
  PublicSale,
  Reveal,
}

export const initializePhases = async (launchPeg: Contract, config: LaunchPegConfig, currentPhase: Phase) => {
  await launchPeg.initializePhases(
    config.auctionStartTime,
    config.startPrice,
    config.endPrice,
    config.auctionDropInterval,
    config.mintlistStartTime,
    config.mintlistDiscount,
    config.publicSaleStartTime,
    config.publicSaleDiscount,
    config.batchRevealStart,
    config.batchRevealInterval
  )
  await launchPeg.setUnrevealedURI(config.unrevealedTokenURI)
  await launchPeg.setBaseURI(config.baseTokenURI)
  await advanceTimeAndBlockToPhase(currentPhase)
}

const advanceTimeAndBlockToPhase = async (phase: Phase) => {
  switch (phase) {
    case Phase.DutchAuction:
      break
    case Phase.Mintlist:
      await advanceTimeAndBlock(duration.minutes(MINTLIST_START_OFFSET))
      break
    case Phase.PublicSale:
      await advanceTimeAndBlock(duration.minutes(PUBLIC_SALE_START_OFFSET))
      break
    case Phase.Reveal:
      await advanceTimeAndBlock(duration.minutes(REVEAL_START_OFFSET))
      break
  }
}
