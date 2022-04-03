import { ethers } from 'hardhat'
import { BigNumber, Contract } from 'ethers'
import { duration, advanceTimeAndBlock } from './time'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

export const LAUNCHPEG_CONFIG = {
  startPrice: ethers.utils.parseUnits('1', 18),
  endPrice: ethers.utils.parseUnits('0.15', 18),
  auctionPriceCurveLength: duration.minutes(340),
  auctionDropInterval: duration.minutes(20),
  mintlistPrice: ethers.utils.parseUnits('0.12', 18),
  publicSalePrice: ethers.utils.parseUnits('0.1', 18),
}

export enum Phase {
  DutchAuction,
  Mintlist,
  PublicSale,
}

export const initializePhases = async (launchPeg: Contract, auctionStartTime: BigNumber, currentPhase: Phase) => {
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

export const fundAddressForMint = async (address: string, quantity: number, price: BigNumber, dev: SignerWithAddress) => {
  const totalPrice = price.mul(quantity)
  await dev.sendTransaction({
    to: address,
    value: totalPrice,
  })
}
