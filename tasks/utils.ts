import fs from 'fs'
import path from 'path'

export const loadLaunchConfig = (filename: string) => {
  const file = path.join(__dirname, `config/${filename}`)
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}
