import '@nomiclabs/hardhat-ethers'
import { parse } from 'csv-parse'
import { task } from 'hardhat/config'
import fs from 'fs'

interface AllowlistRow {
  address: string
  amount: number
}

task('configure-allowlist', 'Configure the Allowlist')
  .addParam('csvPath')
  .addParam('contractAddress')
  .setAction(async ({ csvPath, contractAddress }, hre) => {
    const ethers = hre.ethers
    const rows: AllowlistRow[] = []

    console.log('-- Fetching csv --')

    const parser = fs.createReadStream(csvPath).pipe(parse({ delimiter: ',', from_line: 2 }))

    for await (const record of parser) {
      rows.push({ address: record[0], amount: record[1] })
    }

    const allowlist = [rows.map((row) => ethers.utils.getAddress(row.address)), rows.map((row) => row.amount)]

    console.log('-- Calling seedAllowlist --')
    const launchpeg = await ethers.getContractAt('Launchpeg', contractAddress)

    const tx = await launchpeg.seedAllowlist(allowlist[0], allowlist[1])
    await tx.wait()

    console.log('-- Allowlist configured --')
  })
