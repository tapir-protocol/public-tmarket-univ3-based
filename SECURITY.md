# Security Policy

## Reporting a vulnerability

Please use GitHub private vulnerability reporting for this repository: open the **Security** tab and select **Report a vulnerability**. Do not open a public issue for a suspected vulnerability.

Include where possible:

- affected contract(s) and function(s),
- impact and realistic attack conditions,
- reproduction steps or a proof-of-concept test,
- any affected deployment address.

Please allow reasonable time for investigation and remediation before public disclosure.

## Scope

- Tapir-modified production contracts under `contracts/`.
- Official deployed factories listed in the README and pools created by those factories.

## Out of scope

- Contracts under `contracts/test/`.
- Development tooling that never controls production funds.
- The deliberately unsupported Uniswap V3 `flash()` interface.
- Previously documented audit findings without a new exploit path.

## Existing audit coverage

The Quantstamp report's AMM scope covers `UniswapV3Factory.sol`, `UniswapV3Pool.sol`, and `UniswapV3PoolDeployer.sol`. See [VERIFICATION.md](VERIFICATION.md) for the exact source correspondence and [docs/audits/README.md](docs/audits/README.md) for scope details.
