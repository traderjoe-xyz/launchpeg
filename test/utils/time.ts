import { BigNumber } from 'ethers'
import { ethers } from 'hardhat'

export async function advanceBlock() {
  return ethers.provider.send('evm_mine', [])
}

export async function advanceBlockTo(blockNumber: number) {
  for (let i = await ethers.provider.getBlockNumber(); i < blockNumber; i++) {
    await advanceBlock()
  }
}

export async function latest() {
  const block = await ethers.provider.getBlock('latest')
  return BigNumber.from(block.timestamp)
}

export async function advanceTimeAndBlock(time: BigNumber) {
  await advanceTime(time)
  await advanceBlock()
}

export async function advanceTime(time: BigNumber) {
  await ethers.provider.send('evm_increaseTime', [time.toNumber()])
}

export const duration = {
  seconds: function (val: number) {
    return BigNumber.from(val)
  },
  minutes: function (val: number) {
    return BigNumber.from(val).mul(this.seconds(60))
  },
  hours: function (val: number) {
    return BigNumber.from(val).mul(this.minutes(60))
  },
  days: function (val: number) {
    return BigNumber.from(val).mul(this.hours(24))
  },
  weeks: function (val: number) {
    return BigNumber.from(val).mul(this.days(7))
  },
  years: function (val: number) {
    return BigNumber.from(val).mul(this.days(365))
  },
}
