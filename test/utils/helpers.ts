import { ethers } from 'hardhat'
import { BigNumber, Contract } from 'ethers'
import { duration, advanceTimeAndBlock } from './time'

export const LAUNCHPEG_CONFIG = {
  startPrice: ethers.utils.parseUnits('1', 18),
  endPrice: ethers.utils.parseUnits('0.15', 18),
  auctionPriceCurveLength: duration.minutes(340),
  auctionDropInterval: duration.minutes(20),
  mintlistDiscount: 0.1 * 10000,
  publicSaleDiscount: 0.2 * 10000,
}

export enum Phase {
  DutchAuction,
  Mintlist,
  PublicSale,
}

export const initializePhases = async (launchPeg: Contract, auctionStartTime: BigNumber, currentPhase: Phase) => {
  await launchPeg.initializePhases(
    auctionStartTime,
    LAUNCHPEG_CONFIG.startPrice,
    LAUNCHPEG_CONFIG.endPrice,
    LAUNCHPEG_CONFIG.auctionPriceCurveLength,
    LAUNCHPEG_CONFIG.auctionDropInterval,
    auctionStartTime.add(duration.minutes(10)),
    LAUNCHPEG_CONFIG.mintlistDiscount,
    auctionStartTime.add(duration.minutes(20)),
    LAUNCHPEG_CONFIG.publicSaleDiscount
  )
  await advanceTimeAndBlockToPhase(currentPhase)
}

const advanceTimeAndBlockToPhase = async (phase: Phase) => {
  switch (phase) {
    case Phase.DutchAuction:
      break
    case Phase.Mintlist:
      await advanceTimeAndBlock(duration.minutes(10))
      break
    case Phase.PublicSale:
      await advanceTimeAndBlock(duration.minutes(20))
      break
  }
}
