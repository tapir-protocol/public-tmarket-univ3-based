# Tapir AMM V1

Core automated-market-maker contracts for Tapir Protocol. This repository is a modified fork of Uniswap V3 Core used for DP/YB markets.

- Docs: <https://docs.tapir.money>
- Website: <https://tapir.money>

## How it differs from Uniswap V3

The pool keeps Uniswap V3's concentrated-liquidity design and adds three Tapir-specific behaviors:

1. **Tapir administrator** — every pool stores an immutable `tapirAdmin` selected at creation.
2. **Dynamic swap fees** — `tapirAdmin` can update `dynamicFee` from 0 to 10,000 pips (0% to 1%). The immutable `fee()` remains the pool identifier and tick-spacing selector; integrations must use `dynamicFee()` for the current swap cost.
3. **Swap pausing** — `tapirAdmin` can pause swaps. Minting, burning, and collecting liquidity remain available while swaps are paused.

The Uniswap V3 `flash()` function is deliberately removed to keep deployed bytecode below the EVM contract-size limit. Integrations requiring pool-native flash loans are not compatible.

See [docs/TapirUniswapV3.md](docs/TapirUniswapV3.md) for the detailed change list and integration notes.

## Contracts

| Contract | Role |
|---|---|
| `UniswapV3Factory` | Deploys pools and enables fee tiers |
| `UniswapV3PoolDeployer` | Passes immutable pool parameters during deployment |
| `UniswapV3Pool` | Concentrated-liquidity pool with dynamic fees and swap pausing |

Interfaces, libraries, and test harness contracts live under `contracts/interfaces/`, `contracts/libraries/`, and `contracts/test/`.

## Related repository

Tapir Core creates DP and YB assets and manages depeg-market lifecycles. The public Core repository is [tapir-protocol/public-tapir-core-v1](https://github.com/tapir-protocol/public-tapir-core-v1).

## Getting started

This is a Hardhat project using npm as its supported package manager.

```bash
npm ci
npm run compile
npm test
npm run verify:audit
```

`npm test` runs the 36 tests covering Tapir's dynamic-fee, pause, and administrator changes. The inherited upstream suite is retained for reference and can be run with `npm run test:all`, but it is not a passing release gate: upstream gas and error-message snapshots do not match the newer Hardhat toolchain, and flash-loan tests are inapplicable because `flash()` was intentionally removed.

## Deployments

Only factory deployments are listed here. Market-specific AMM pools, Tapir
Core depeg pools, and direct application market links are intentionally
excluded from this repository.

| Network     | Contract           | Address                                                                                                                      |
| ----------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Base (8453) | `UniswapV3Factory` | [`0xa6FCDCd4A53072e8A5A73344fdB2ddFCDd78F94B`](https://basescan.org/address/0xa6FCDCd4A53072e8A5A73344fdB2ddFCDd78F94B#code) |

Verify addresses independently before interacting.

## Audits and verification

The [Quantstamp final report](docs/audits/Tapir_Final_Report_Quantstamp.pdf) reviewed the three implementation files in its AMM scope at development commit `ff4d820`: `UniswapV3Factory.sol`, `UniswapV3Pool.sol`, and `UniswapV3PoolDeployer.sol`.

[VERIFICATION.md](VERIFICATION.md) and `npm run verify:audit` provide a reproducible proof connecting that private-development commit to this fresh-history public repository. Factory and deployer are byte-identical to the audited state. The pool differs only by the post-audit NatSpec/comments recorded in a checked patch; executable Solidity is unchanged.

The original Uniswap V3 ABDK and Trail of Bits materials are preserved under `docs/audits/uniswap/` for upstream context. Audit scope and limitations are summarized in [docs/audits/README.md](docs/audits/README.md).

## Security

See [SECURITY.md](SECURITY.md) for private vulnerability reporting. Do not open a public issue for suspected vulnerabilities.

## License

This repository is derived from Uniswap V3 Core. The root [LICENSE](LICENSE) contains the applicable Business Source License 1.1 terms and its GPL-2.0-or-later change-license provision. Individual interface and library files may carry separate GPL or MIT notices; retain all notices when redistributing or modifying the code.
