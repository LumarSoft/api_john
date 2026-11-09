#!/usr/bin/env node
// Checks the Sancor access with what is in .env: asks for the intermediary's
// token and, when it gets one and SANCOR_CHECK_DNI is set, looks one DNI up in
// the cartera. Prints what happened, never the password or the token.
//
//   node scripts/sancor-check.cjs
//   SANCOR_CHECK_DNI=<dni de un asegurado> node scripts/sancor-check.cjs
const fs = require('fs')
const path = require('path')

const envPath = path.join(__dirname, '..', '.env')
const env = {}
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, '')
  }
}
const get = key => (process.env[key] ?? env[key] ?? '').trim()

const baseUrl = get('SANCOR_BASE_URL') || 'https://external-pre-api.gruposancorseguros.com/apissa/pre-catalog'
const clientId = get('SANCOR_CLIENT_ID')
const username = get('SANCOR_USERNAME')
const password = get('SANCOR_PASSWORD')
const appClient = get('SANCOR_APP_CLIENT')

const missing = [
  ['SANCOR_CLIENT_ID', clientId],
  ['SANCOR_USERNAME', username],
  ['SANCOR_PASSWORD', password],
]
  .filter(([, value]) => !value)
  .map(([key]) => key)
if (missing.length) {
  print(`Falta cargar en .env: ${missing.join(', ')}`)
  process.exit(2)
}

const headers = { 'Content-Type': 'application/json', gss_apiclient_id: clientId, 'X-IBM-Client-Id': clientId }
const brief = text => text.replace(/\s+/g, ' ').slice(0, 300)
const print = line => process.stdout.write(`${line}\n`)

;(async () => {
  print(`Ambiente: ${baseUrl}`)
  print(`Usuario: ${username.slice(0, 3)}… (${username.length} caracteres)`)
  const response = await fetch(`${baseUrl}/v2/security/auth0/token`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ username, password, ...(appClient ? { app_client: appClient } : {}) }),
    signal: AbortSignal.timeout(20_000),
  })
  const text = await response.text()
  let data = null
  try {
    data = JSON.parse(text)
  } catch {
    // Not JSON: an HTML error page of the gateway.
  }
  if (!response.ok || !data?.access_token) {
    // The error of Sancor, without anything we sent.
    print(`Token: NO (HTTP ${response.status}) — ${brief(data ? JSON.stringify(data) : text)}`)
    process.exit(1)
  }
  print(`Token: OK (vence en ${data.expires_in ?? '?'} s, tipo ${data.token_type ?? '?'})`)

  const dni = get('SANCOR_CHECK_DNI')
  if (!dni) return
  const url = new URL(`${baseUrl}/policies`)
  url.searchParams.set('identificationNumber', dni)
  const policies = await fetch(url, {
    headers: { ...headers, Authorization: `Bearer ${data.access_token}` },
    signal: AbortSignal.timeout(20_000),
  })
  const body = await policies.text()
  print(`Cartera: HTTP ${policies.status} — ${brief(body)}`)
})().catch(error => {
  print(`No se pudo consultar a Sancor: ${error.message}`)
  process.exit(1)
})
