Lombard Vault Challenge
=======================

script to inspect the Lombard vault and optionally deposit or request withdrawals.

Setup
-----
- **Install deps**: `npm install`
- **Env file**: copy `.env.example` to `.env` and fill in values:
  - `RPC_URL`, `PRIVATE_KEY`
  - `BTC_PRICE_URL`
  - optional: `DEPOSIT_ASSET`, `WITHDRAW_ASSET`, `WITHDRAW_DEADLINE_DAYS`
  - optional: `DEPOSIT_AMOUNT`, `WITHDRAW_AMOUNT`

How to run
----------
- **Read-only info (no txs)**: leave `PRIVATE_KEY` empty, then run:
  - `npx ts-node vault.ts`
- **Run with a wallet (can deposit / withdraw)**:
  - set `PRIVATE_KEY` and other values in `.env`
  - (optional) set `DEPOSIT_AMOUNT` to auto-deposit on run
  - (optional) set `WITHDRAW_AMOUNT` to request withdraw on run
  - then run: `npx ts-node vault.ts`

