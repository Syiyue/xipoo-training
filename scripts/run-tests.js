const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const testsDir = path.join(__dirname, '..', 'tests')
const files = fs.readdirSync(testsDir).filter((f) => f.endsWith('.test.js')).sort()

let failed = 0
for (const file of files) {
  const result = spawnSync(process.execPath, [path.join(testsDir, file)], { stdio: 'inherit' })
  if (result.status !== 0) {
    failed += 1
    console.error(`FAILED: ${file}`)
  }
}

console.log(`\n${files.length - failed}/${files.length} test files passed`)
process.exit(failed ? 1 : 0)
