#!/usr/bin/env bash
#
# Team1 Track B — delivery-versus-payment on Avalanche Fuji, live.
#
# Runs the two transactions that turn the deployed contract into a
# demonstrated end-to-end flow:
#
#   1. setKycApproval(buyer, true)   — the eligibility policy, set by the owner
#   2. settlePurchase(tokenId)       — atomic DvP at exactly 0.01 AVAX
#
# It prints ownership and balances either side of each step, so the camera sees
# the token and the money move together rather than a bare transaction hash.
#
# Usage:
#   export RELAYER_PRIVATE_KEY=0x...   # owns the contract and the token (seller)
#   export BUYER_PRIVATE_KEY=0x...     # a second funded wallet
#   ./scripts/demo-settlement.sh
#
# Nothing is hardcoded except the Fuji RPC: override any value via the
# environment. Private keys are read from the environment and never echoed.

set -euo pipefail

RPC_URL="${RPC_URL:-https://api.avax-test.network/ext/bc/C/rpc}"
CONTRACT="${CONTRACT:-0x1774961c3E68c54828b422bdDb2735D77D7429D8}"

# tokenId == uint256(documentHash): the asset rule, so the token id IS the
# document's SHA-256. This default is the demo invoice minted on Fuji, and it
# is reproducible — the same digest indexes the record on Arkiv:
#   printf '%s' 'Ancorhash ETHRome 2026 demo invoice' | shasum -a 256
TOKEN_ID="${TOKEN_ID:-0x91b4e781b2cbed53941e491a79de0b5981ba82de1a1b27b61fb5d5b02351a7bb}"

PRICE_ETHER="${PRICE_ETHER:-0.01ether}"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
dim()  { printf '\033[2m%s\033[0m\n' "$*"; }
fail() { printf '\033[1mERROR:\033[0m %s\n' "$*" >&2; exit 1; }
# macOS ships bash 3.2, which has no ${VAR,,} lowercase expansion. Addresses
# come back from cast in mixed case, so compare them through tr instead.
lc()   { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

command -v cast >/dev/null || fail "cast not found. Install Foundry: https://getfoundry.sh"
[ -n "${RELAYER_PRIVATE_KEY:-}" ] || fail "RELAYER_PRIVATE_KEY is not set (the seller / contract owner)."
[ -n "${BUYER_PRIVATE_KEY:-}" ]   || fail "BUYER_PRIVATE_KEY is not set (a second funded wallet)."

SELLER=$(cast wallet address --private-key "$RELAYER_PRIVATE_KEY")
BUYER=$(cast wallet address  --private-key "$BUYER_PRIVATE_KEY")

call()  { cast call "$CONTRACT" "$@" --rpc-url "$RPC_URL"; }
bal()   { cast balance "$1" --rpc-url "$RPC_URL"; }
# Values arrive as bare wei integers from cast. Passed via argv rather than
# interpolated into the Python literal: macOS ships Python 3.9, which rejects
# nested quotes inside an f-string, and this script runs live on camera.
avax()  { python3 -c 'import sys;print("%.6f" % (int(sys.argv[1])/1e18))' "$1"; }

bold "== Ancorhash — Track B settlement on Avalanche Fuji =="
dim  "contract $CONTRACT"
dim  "token    $TOKEN_ID"
echo "seller (owner) : $SELLER"
echo "buyer          : $BUYER"
echo

# --- preconditions, checked before spending anything ------------------------
[ "$(cast code "$CONTRACT" --rpc-url "$RPC_URL")" != "0x" ] \
  || fail "No contract at $CONTRACT on this network."

CURRENT_OWNER=$(call "ownerOf(uint256)(address)" "$TOKEN_ID" 2>/dev/null) \
  || fail "Token $TOKEN_ID does not exist. Mint it first, or set TOKEN_ID."

if [ "$(lc "$CURRENT_OWNER")" != "$(lc "$SELLER")" ]; then
  fail "The token is owned by $CURRENT_OWNER, not by the seller $SELLER.
       settlePurchase() pays the current owner, so run this with that key,
       or pick a token the seller still holds."
fi

[ "$(lc "$BUYER")" != "$(lc "$SELLER")" ] \
  || fail "Buyer and seller are the same wallet. The contract rejects that
       (CannotBuyOwnToken) — DvP between one party is not a settlement."

BUYER_BAL=$(bal "$BUYER")
python3 -c "import sys; sys.exit(0 if int('$BUYER_BAL') > 11*10**15 else 1)" \
  || fail "Buyer holds $(avax "$BUYER_BAL") AVAX — not enough for 0.01 plus gas.
       Fund it: https://core.app/tools/testnet-faucet/"

PRICE=$(call "SETTLEMENT_PRICE()(uint256)" | awk '{print $1}')
bold "-- before --"
echo "  token owner     : $CURRENT_OWNER  (seller)"
echo "  seller balance  : $(avax "$(bal "$SELLER")") AVAX"
echo "  buyer balance   : $(avax "$BUYER_BAL") AVAX"
echo "  buyer KYC       : $(call "kycApproved(address)(bool)" "$BUYER")"
echo "  settlement price: $(avax "$PRICE") AVAX (fixed, read from the contract)"
echo

# --- 1. eligibility policy --------------------------------------------------
bold "-- 1. setKycApproval(buyer, true) --"
dim  "   The transfer policy lives in _update(), so this gates every movement:"
dim  "   transferFrom, safeTransferFrom and settlement alike."
cast send "$CONTRACT" "setKycApproval(address,bool)" "$BUYER" true \
  --private-key "$RELAYER_PRIVATE_KEY" --rpc-url "$RPC_URL" \
  | grep -E "^(status|transactionHash)" | sed 's/^/   /'
echo "   buyer KYC now: $(call "kycApproved(address)(bool)" "$BUYER")"
echo

# --- 2. delivery versus payment --------------------------------------------
SELLER_BEFORE=$(bal "$SELLER")
bold "-- 2. settlePurchase(tokenId) with value = $PRICE_ETHER --"
dim  "   Atomic: the token moves and the seller is paid in one transaction,"
dim  "   or neither happens. Called by the BUYER, not the seller."
cast send "$CONTRACT" "settlePurchase(uint256)" "$TOKEN_ID" \
  --value "$PRICE_ETHER" \
  --private-key "$BUYER_PRIVATE_KEY" --rpc-url "$RPC_URL" \
  | grep -E "^(status|transactionHash)" | sed 's/^/   /'
echo

# --- proof ------------------------------------------------------------------
SELLER_AFTER=$(bal "$SELLER")
bold "-- after --"
echo "  token owner    : $(call "ownerOf(uint256)(address)" "$TOKEN_ID")"
echo "                   (expected the buyer: $BUYER)"
DELTA=$(python3 -c 'import sys;print("%+.6f" % ((int(sys.argv[1])-int(sys.argv[2]))/1e18))' "$SELLER_AFTER" "$SELLER_BEFORE")
echo "  seller received: $DELTA AVAX  (the contract's fixed price, paid atomically)"
echo "  buyer balance  : $(avax "$(bal "$BUYER")") AVAX"
echo
dim "Asset rule, transfer policy and settlement — all three exercised on Fuji."
dim "Explorer: https://testnet.snowtrace.io/address/$CONTRACT"
