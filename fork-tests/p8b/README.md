# P8B fork rehearsal (test-only evidence)

LOCAL IN-MEMORY FORK ONLY. Nothing here is bundled into the app, run in CI, or able to broadcast.
No RPC URL or keys are stored here. Test accounts are deterministic local fixtures (`0xA11CE1..3`, `0xB1D0..`), never real owner keys.

- `P8BForkRehearsal.t.sol` — 2-of-3 rehearsal Safe, frozen fork-only PCART, locked P8B v1 parameters, full 30 ETH success and 4 ETH below-threshold refund auctions, prints the pre-auction and sweep SafeTx hashes that `src/lib/pcart-auction-execution-p8b.ts` must reproduce.
- `P8BParamAudit.t.sol` — floor / step / release-schedule / bid-timing matrix used to choose the parameters.
- `pcart.creation.hex` — frozen `pepecartel-token-v1` creation bytecode (keccak `0x2edebe9d…2196`).

Pinned sources: Uniswap liquidity-launcher `v3.3.0` @ `e428c3f8fc7b76a2c75abf6e4a7b5a193a89319b`; continuous-clearing-auction `v2.1.0` @ `a56d42231e7bf048136d9d88fa61e8518c10c5ff`. Foundry 1.4.4.

## Safe rerun (manual only)

```sh
git clone https://github.com/Uniswap/liquidity-launcher /tmp/llv && cd /tmp/llv
git checkout e428c3f8fc7b76a2c75abf6e4a7b5a193a89319b && git submodule update --init --recursive
mkdir -p test/p8b script && cp <repo>/fork-tests/p8b/*.t.sol test/p8b/ && cp <repo>/fork-tests/p8b/pcart.creation.hex script/
export ROBINHOOD_MAINNET_RPC_URL=<read-only Robinhood Chain mainnet RPC>   # read at runtime, never committed
forge test --match-contract '^P8BForkRehearsal$' -vv --gas-limit 18446744073709551615
forge test --match-contract P8BParamAudit -vv --gas-limit 18446744073709551615
```

Guards: `vm.createSelectFork` builds an in-memory fork pinned to block 82,592,963 and the test requires `chainid == 4663`; Foundry tests never broadcast. The real Treasury Safe is only read (`test_attestRealSafeReadOnly`).
