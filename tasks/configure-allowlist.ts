import '@nomiclabs/hardhat-ethers'
import { parse } from 'csv-parse'
import { task } from 'hardhat/config'
import fs from 'fs'
import jsonfile from 'jsonfile'

interface AllowlistRow {
  address: string
  amount: number
}

task('configure-allowlist', 'Configure the Allowlist')
  .addParam('csvPath')
  .addParam('contractAddress')
  .addOptionalParam('outputTx')
  .setAction(async ({ csvPath, contractAddress, outputTx }, hre) => {
    const ethers = hre.ethers
    const rows: AllowlistRow[] = []

    console.log('-- Fetching csv --')

    const parser = fs.createReadStream(csvPath).pipe(parse({ delimiter: ',', from_line: 2 }))

    for await (const record of parser) {
      rows.push({ address: record[0], amount: parseInt(record[1]) })
    }

    const MAX_ADDRESS_PER_TX = 200
    const steps = Math.floor(rows.length / MAX_ADDRESS_PER_TX) + (rows.length % MAX_ADDRESS_PER_TX === 0 ? 0 : 1)

    let allowlistSpots = 0
    for (let i = 0; i < rows.length; i++) {
      allowlistSpots += rows[i].amount
    }

    console.log(`Giving ${rows.length} addresses ${allowlistSpots} allowlist spots, in ${steps} transaction`)

    let allowlist: [[string[], number[]]] = [[[], []]]
    for (let i = 0; i < steps; i++) {
      allowlist.push([
        rows
          .slice(i * MAX_ADDRESS_PER_TX, (i + 1) * MAX_ADDRESS_PER_TX - 1)
          .map((row) => ethers.utils.getAddress(row.address.trim())),
        rows.slice(i * MAX_ADDRESS_PER_TX, (i + 1) * MAX_ADDRESS_PER_TX - 1).map((row) => row.amount),
      ])
    }

    console.log('-- Calling seedAllowlist --')
    const launchpeg = await ethers.getContractAt('Launchpeg', contractAddress)

    for (let i = 0; i < steps; i++) {
      if (outputTx) {
        await jsonfile.writeFile(`${i}-addresses.txt`, allowlist[i + 1][0])
        await jsonfile.writeFile(`${i}-amounts.txt`, allowlist[i + 1][1])
      } else {
        const tx = await launchpeg.seedAllowlist(allowlist[i + 1][0], allowlist[i + 1][1])
        await tx.wait()
      }
    }

    console.log('-- Allowlist configured --')
  })
