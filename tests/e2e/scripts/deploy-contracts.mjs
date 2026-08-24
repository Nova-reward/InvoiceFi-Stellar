#!/usr/bin/env node

/**
 * Deploys the Soroban contracts (invoice, financing-pool, settlement,
 * access-control) to the local standalone network and writes the contract
 * IDs to .env.test.
 *
 * Usage:
 *   node scripts/deploy-contracts.mjs
 *
 * Prerequisites:
 *   - `stellar` CLI installed
 *   - Local Stellar standalone running (docker compose up stellar-standalone)
 *   - Accounts provisioned (provision-accounts.mjs)
 */

import { execSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const CONTRACTS_DIR = resolve(ROOT, 'contracts');
const ENV_TEST = resolve(__dirname, '../.env.test');

const NETWORK_PASSPHRASE = process.env.NETWORK_PASSPHRASE || 'Standalone Network ; February 2017';
const RPC_URL = process.env.SOROBAN_RPC_URL || 'http://localhost:8001';
const CONTRACTS = ['access-control', 'invoice', 'financing-pool', 'settlement'];

function log(msg) {
  console.log(`[deploy] ${msg}`);
}

function run(cmd, opts = {}) {
  log(`$ ${cmd}`);
  return execSync(cmd, {
    cwd: ROOT,
    env: {
      ...process.env,
      SOROBAN_RPC_URL: RPC_URL,
      SOROBAN_NETWORK_PASSPHRASE: NETWORK_PASSPHRASE,
    },
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    ...opts,
  });
}

function getTestAccountSecret() {
  if (existsSync(ENV_TEST)) {
    const content = readFileSync(ENV_TEST, 'utf-8');
    const match = content.match(/FARMER_STELLAR_ACCOUNT=({.*})/);
    if (match) {
      const account = JSON.parse(match[1]);
      return account.secretKey;
    }
  }
  return process.env.FARMER_SECRET_KEY || '';
}

async function run_() {
  log('Deploying Soroban contracts to local network...');

  const secretKey = getTestAccountSecret();
  if (!secretKey) {
    log('ERROR: No account secret key found. Run provision-accounts.mjs first.');
    process.exit(1);
  }

  const contractIds = {};

  for (const contract of CONTRACTS) {
    try {
      log(`Deploying ${contract}...`);

      const wasmPath = resolve(CONTRACTS_DIR, 'target', 'wasm32-unknown-unknown', 'release', `${contract.replace('-', '_')}.wasm`);

      if (!existsSync(wasmPath)) {
        log(`Building ${contract}...`);
        run(`cargo build --target wasm32-unknown-unknown --release -p ${contract}`, {
          cwd: CONTRACTS_DIR,
        });
      }

      const output = run(
        `stellar contract deploy --wasm "${wasmPath}" --source "${secretKey}" --network standalone`,
      );

      const contractId = output.trim();
      contractIds[contract] = contractId;
      log(`${contract}: ${contractId}`);

      if (contract === 'invoice' || contract === 'financing-pool' || contract === 'settlement') {
        try {
          log(`Initializing ${contract}...`);
          run(
            `stellar contract invoke --id "${contractId}" --source "${secretKey}" --network standalone -- initialize --signers "[\\\"${secretKey.substring(0, 56)}...\\\"]" --threshold 1 --timelock_ledgers 100`,
          );
        } catch (initErr) {
          log(`Warning: could not initialize ${contract}: ${initErr.message}`);
        }
      }
    } catch (err) {
      log(`Warning: failed to deploy ${contract}: ${err.message}`);
      contractIds[contract] = `DEPLOY_FAILED_${contract}`;
    }
  }

  if (existsSync(ENV_TEST)) {
    let envContent = readFileSync(ENV_TEST, 'utf-8');

    for (const [name, id] of Object.entries(contractIds)) {
      const varName = `${name.replace(/-/g, '_').toUpperCase()}_CONTRACT_ID`;
      const regex = new RegExp(`^${varName}=.*$`, 'm');
      const line = `${varName}=${id}`;
      if (regex.test(envContent)) {
        envContent = envContent.replace(regex, line);
      } else {
        envContent += `\n${line}`;
      }
    }

    writeFileSync(ENV_TEST, envContent);
    log(`Updated ${ENV_TEST} with contract IDs`);
  }

  log('Contract deployment complete.');
  console.log('\n--- Contract IDs ---');
  for (const [name, id] of Object.entries(contractIds)) {
    console.log(`${name}: ${id}`);
  }
  console.log('--------------------\n');

  return contractIds;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run_().catch((err) => {
    console.error('Deployment failed:', err);
    process.exit(1);
  });
}

export { run as deployContracts };
