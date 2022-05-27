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
    return new Promise<void>((resolve, reject) => {
      const ethers = hre.ethers
      const rows: AllowlistRow[] = []

      console.log('-- Fetching csv --')

      fs.createReadStream(csvPath)
        .pipe(parse({ delimiter: ',', from_line: 2 }))
        .on('data', function (row) {
          rows.push({ address: row[0], amount: row[1] })
        })
        .on('end', async function () {
          const allowlist = [rows.map((row) => ethers.utils.getAddress(row.address)), rows.map((row) => row.amount)]

          console.log('-- Calling seedAllowlist --')
          const launchpeg = await ethers.getContractAt('Launchpeg', contractAddress)

          const tx = await launchpeg.seedAllowlist(allowlist[0], allowlist[1])
          await tx.wait()

          console.log('-- Allowlist configured --')
          resolve()
        })
        .on('error', function (error) {
          console.log(error.message)
          reject()
        })
    })
  })
