const https = require('https')

function callCloudFn(action, payload, token = '') {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ action, token, payload })
    const options = {
      hostname: 'cloudbase-d7gowjn4mf367be4d.tcloudbaseapp.com',
      port: 443,
      path: '/activityAdmin',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    }

    const req = https.request(options, (res) => {
      let body = ''
      res.on('data', (chunk) => body += chunk)
      res.on('end', () => {
        try {
          resolve(JSON.parse(body))
        } catch (e) {
          reject(new Error('Invalid JSON response: ' + body.substring(0, 200)))
        }
      })
    })

    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

async function main() {
  try {
    console.log('Step 1: Login...')
    const loginRes = await callCloudFn('login', { username: 'admin', password: 'xipoo2026' })
    console.log('Login result:', JSON.stringify(loginRes))
    
    if (!loginRes.ok || !loginRes.data || !loginRes.data.token) {
      console.error('Login failed:', loginRes.message)
      process.exit(1)
    }

    const token = loginRes.data.token
    console.log('\nStep 2: Creating PAI Space publisher and workshop activity...')
    const setupRes = await callCloudFn('setupDemoData', {}, token)
    console.log('Setup result:', JSON.stringify(setupRes))

    if (setupRes.ok) {
      console.log('\n✅ Success! PAI Space and workshop activity have been created.')
      console.log('Date:', setupRes.data.date)
    } else {
      console.error('\n❌ Failed:', setupRes.message)
      process.exit(1)
    }
  } catch (e) {
    console.error('Error:', e.message)
    process.exit(1)
  }
}

main()
