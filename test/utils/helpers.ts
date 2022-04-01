import { ethers } from 'hardhat'
import { BigNumber, Contract } from 'ethers'
import { duration } from './time'

export const LAUNCHPEG_CONFIG = {
  startPrice: ethers.utils.parseUnits('1', 18),
  endPrice: ethers.utils.parseUnits('0.15', 18),
  auctionPriceCurveLength: duration.minutes(340),
  auctionDropInterval: duration.minutes(20),
  mintlistPrice: ethers.utils.parseUnits('0.12', 18),
  publicSalePrice: ethers.utils.parseUnits('0.1', 18),
}

export const initializePhases = (launchPeg: Contract, auctionStartTime: BigNumber) => {
  launchPeg.initializePhases(
    auctionStartTime,
    LAUNCHPEG_CONFIG.startPrice,
    LAUNCHPEG_CONFIG.endPrice,
    LAUNCHPEG_CONFIG.auctionPriceCurveLength,
    LAUNCHPEG_CONFIG.auctionDropInterval,
    auctionStartTime.add(duration.minutes(10)),
    LAUNCHPEG_CONFIG.mintlistPrice,
    auctionStartTime.add(duration.minutes(20)),
    LAUNCHPEG_CONFIG.publicSalePrice
  )
}
