# Audit Reports

## Tapir-specific changes

`Tapir_Final_Report_Quantstamp.pdf` is Quantstamp's final Tapir Protocol report. Its AMM scope is limited to these three implementation files:

- `contracts/UniswapV3Factory.sol`
- `contracts/UniswapV3Pool.sol`
- `contracts/UniswapV3PoolDeployer.sol`

The report pins development commit `ff4d820` and records all nine cross-repository findings as fixed. The report explicitly assumes unchanged Uniswap V3 functionality is safe rather than re-auditing it.

The exact audited versions of the three AMM files are preserved in `quantstamp-source/contracts/`. See the repository's [VERIFICATION.md](../../VERIFICATION.md) for a cryptographic link from the report's commit hash to those files and from those files to the public release.

SHA-256 of the report:

```text
ac73a19d1ac896c4c74324bf20c0030ae4b724e37c02a6dedc348babfc58ad49  Tapir_Final_Report_Quantstamp.pdf
```

## Upstream Uniswap V3 material

The `uniswap/` directory preserves the ABDK and Trail of Bits reports and associated verification material distributed with Uniswap V3 Core. Those reports cover the upstream implementation, not Tapir's later modifications. The accompanying commands and Solidity harnesses target the original upstream repository layout and API; they are archival material, not a Tapir-compatible test suite.
