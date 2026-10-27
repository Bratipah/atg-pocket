const path = require('node:path')
const { app, utilityProcess } = require('electron')

let worker
let timer
let resultReceived = false

app.whenReady().then(() => {
  worker = utilityProcess.fork(path.join(__dirname, 'electron-qvac-worker.mjs'), [], {
    serviceName: 'ATG QVAC feasibility worker',
    stdio: 'pipe',
    env: Object.fromEntries(Object.entries({
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
      QVAC_CONFIG_PATH: path.join(__dirname, 'qvac.config.json'),
    }).filter(([, value]) => typeof value === 'string')),
  })

  worker.stdout?.on('data', (chunk) => process.stdout.write(`[worker] ${chunk}`))
  worker.stderr?.on('data', (chunk) => process.stderr.write(`[worker] ${chunk}`))
  worker.on('message', (message) => {
    resultReceived = true
    process.stdout.write(`${JSON.stringify({ electron: process.versions.electron, ...message })}\n`)
    clearTimeout(timer)
  })
  worker.on('exit', (code) => {
    if (code !== 0 || !resultReceived) process.exitCode = 1
    clearTimeout(timer)
    app.quit()
  })
  timer = setTimeout(() => {
    process.stderr.write('Electron QVAC worker timed out after 90 seconds\n')
    process.exitCode = 1
    worker.kill()
    app.exit(1)
  }, 90000)
}).catch((error) => {
  process.stderr.write(`Electron QVAC harness failed: ${error.stack ?? error}\n`)
  process.exitCode = 1
  app.exit(1)
})
