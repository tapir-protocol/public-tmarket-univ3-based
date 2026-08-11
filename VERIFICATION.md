# Audit Verification

The Quantstamp report (`docs/audits/Tapir_Final_Report_Quantstamp.pdf`) identifies the Tapir AMM source as:

| Report field | Value |
|---|---|
| Repository | `tapir-protocol/tmarket-univ3-based` |
| Audited/fix-review commit | `ff4d820` |
| Included paths | `contracts/UniswapV3Factory.sol`, `contracts/UniswapV3Pool.sol`, `contracts/UniswapV3PoolDeployer.sol` |

The development and public repositories intentionally have different commit histories. This repository contains a fresh public-release commit without private development history. The proof below connects the report's commit to the public files without requiring access to the development repository.

## One-command verification

From a clone of this repository:

```bash
npm run verify:audit
```

The script performs every check described below and exits nonzero on any mismatch.

## What is proved

| File | Relationship to audited commit `ff4d820…` |
|---|---|
| `contracts/UniswapV3Factory.sol` | Byte-for-byte identical |
| `contracts/UniswapV3PoolDeployer.sol` | Byte-for-byte identical |
| `contracts/UniswapV3Pool.sol` | Audited source plus the exact comment-only patch in `verification/quantstamp/post-audit-documentation.patch` |

No executable Solidity was added to the three-file Quantstamp scope after the audited commit. The 21 added lines document the dual-fee model and the deliberate removal of `flash()`—the documentation requested by the audit.

## How the proof works

A Git commit identifies a root tree; that tree identifies the `contracts/` tree; the contracts tree identifies the blob hash of each audited file. Git object hashes are content-derived, so reconstructing the object chain proves which bytes belonged to the commit named in the report.

The proof bundle contains:

- the complete audited commit object,
- the raw audited root and contracts tree objects, base64-encoded,
- exact copies of the three audited source files,
- the complete post-audit documentation patch,
- SHA-256 checksums for the report and both audited/current files.

### Step 1 — Reconstruct the report's commit

```bash
git hash-object -t commit verification/quantstamp/audited-commit.txt
```

Expected output:

```text
ff4d820b7dc24a037683240dde4e39332cdf54e2
```

Its first seven characters match `ff4d820` on the report's front page. The reconstructed commit names root tree `9393ee01900f6c9cd4acdb76f973139d320b478d`.

### Step 2 — Reconstruct the audited trees

```bash
base64 -d verification/quantstamp/audited-root-tree.base64 \
  | git hash-object --literally -t tree -w --stdin

base64 -d verification/quantstamp/audited-contracts-tree.base64 \
  | git hash-object --literally -t tree -w --stdin
```

Expected outputs:

```text
9393ee01900f6c9cd4acdb76f973139d320b478d
ff9f1b14fd402f1e52862d8c3d49bffa5447a447
```

Inspecting the objects shows that the root tree names `ff9f1b14…` as its `contracts` subtree, and that subtree names these audited blobs:

| File | Git blob hash |
|---|---|
| `UniswapV3Factory.sol` | `6d892c3ecf5db9c5fe38b896d0387f55977819c5` |
| `UniswapV3Pool.sol` | `dfb34ac871f6caaebb9ac16e37b52c17a5e1d891` |
| `UniswapV3PoolDeployer.sol` | `ffc1a8b0317b20423228d722e07453d5d4c2b65e` |

Hash the preserved audited sources to confirm those blob IDs:

```bash
git hash-object docs/audits/quantstamp-source/contracts/*.sol
```

### Step 3 — Compare the public release

Factory and deployer compare directly:

```bash
cmp docs/audits/quantstamp-source/contracts/UniswapV3Factory.sol \
    contracts/UniswapV3Factory.sol

cmp docs/audits/quantstamp-source/contracts/UniswapV3PoolDeployer.sol \
    contracts/UniswapV3PoolDeployer.sol
```

Both commands produce no output and exit successfully.

For the pool, apply the checked-in post-audit patch to a temporary copy of the audited file, then compare it to the release:

```bash
tmp_dir="$(mktemp -d)"
mkdir -p "$tmp_dir/contracts"
cp docs/audits/quantstamp-source/contracts/UniswapV3Pool.sol "$tmp_dir/contracts/"
git -C "$tmp_dir" apply "$PWD/verification/quantstamp/post-audit-documentation.patch"
cmp "$tmp_dir/contracts/UniswapV3Pool.sol" contracts/UniswapV3Pool.sol
rm -r "$tmp_dir"
```

The patch is human-readable and every added line begins with a Solidity comment marker.

Finally, verify the SHA-256 manifest:

```bash
sha256sum --check verification/quantstamp/SHA256SUMS
```

## Expected public contract tree

After the initial public commit, this command:

```bash
git rev-parse HEAD:contracts
```

must output:

```text
887c39a1cfe71867a07a9df99801a37bb98a81ae
```

That is the complete current `contracts/` tree, including unchanged upstream code, interfaces, libraries, and test harnesses.

## Limitations

- Quantstamp reviewed only the three files listed above in this repository. It assumed unchanged upstream Uniswap V3 behavior was safe.
- The ABDK and Trail of Bits reports under `docs/audits/uniswap/` concern the upstream Uniswap V3 implementation, not Tapir's modifications.
- Equality with audited source is evidence of source correspondence, not a guarantee that deployments, administrator configuration, or integrations are safe.
