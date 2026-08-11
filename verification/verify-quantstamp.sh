#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

fail() {
  echo "verification failed: $*" >&2
  exit 1
}

expect_equal() {
  local actual="$1"
  local expected="$2"
  local label="$3"
  [[ "$actual" == "$expected" ]] || fail "$label: expected $expected, got $actual"
  echo "ok: $label = $actual"
}

audited_commit="$(git hash-object -t commit verification/quantstamp/audited-commit.txt)"
expect_equal "$audited_commit" "ff4d820b7dc24a037683240dde4e39332cdf54e2" "audited commit"

proof_object_dir="$(mktemp -d)"
tmp_dir=""
cleanup() {
  rm -r "$proof_object_dir"
  if [[ -n "$tmp_dir" ]]; then
    rm -r "$tmp_dir"
  fi
}
trap cleanup EXIT

root_tree="$(base64 -d verification/quantstamp/audited-root-tree.base64 | GIT_OBJECT_DIRECTORY="$proof_object_dir" git hash-object --literally -t tree -w --stdin)"
expect_equal "$root_tree" "9393ee01900f6c9cd4acdb76f973139d320b478d" "audited root tree"

contracts_tree="$(base64 -d verification/quantstamp/audited-contracts-tree.base64 | GIT_OBJECT_DIRECTORY="$proof_object_dir" git hash-object --literally -t tree -w --stdin)"
expect_equal "$contracts_tree" "ff9f1b14fd402f1e52862d8c3d49bffa5447a447" "audited contracts tree"

root_contracts_tree="$(GIT_OBJECT_DIRECTORY="$proof_object_dir" git cat-file -p "$root_tree" | awk '$4 == "contracts" { print $3 }')"
expect_equal "$root_contracts_tree" "$contracts_tree" "root-to-contracts link"

audited_factory="$(git hash-object docs/audits/quantstamp-source/contracts/UniswapV3Factory.sol)"
audited_pool="$(git hash-object docs/audits/quantstamp-source/contracts/UniswapV3Pool.sol)"
audited_deployer="$(git hash-object docs/audits/quantstamp-source/contracts/UniswapV3PoolDeployer.sol)"

expect_equal "$audited_factory" "6d892c3ecf5db9c5fe38b896d0387f55977819c5" "audited factory blob"
expect_equal "$audited_pool" "dfb34ac871f6caaebb9ac16e37b52c17a5e1d891" "audited pool blob"
expect_equal "$audited_deployer" "ffc1a8b0317b20423228d722e07453d5d4c2b65e" "audited deployer blob"

tree_factory="$(GIT_OBJECT_DIRECTORY="$proof_object_dir" git cat-file -p "$contracts_tree" | awk '$4 == "UniswapV3Factory.sol" { print $3 }')"
tree_pool="$(GIT_OBJECT_DIRECTORY="$proof_object_dir" git cat-file -p "$contracts_tree" | awk '$4 == "UniswapV3Pool.sol" { print $3 }')"
tree_deployer="$(GIT_OBJECT_DIRECTORY="$proof_object_dir" git cat-file -p "$contracts_tree" | awk '$4 == "UniswapV3PoolDeployer.sol" { print $3 }')"

expect_equal "$tree_factory" "$audited_factory" "contracts-tree factory link"
expect_equal "$tree_pool" "$audited_pool" "contracts-tree pool link"
expect_equal "$tree_deployer" "$audited_deployer" "contracts-tree deployer link"

cmp docs/audits/quantstamp-source/contracts/UniswapV3Factory.sol contracts/UniswapV3Factory.sol \
  || fail "factory differs from audited source"
echo "ok: current factory is byte-identical to audited source"

cmp docs/audits/quantstamp-source/contracts/UniswapV3PoolDeployer.sol contracts/UniswapV3PoolDeployer.sol \
  || fail "deployer differs from audited source"
echo "ok: current deployer is byte-identical to audited source"

tmp_dir="$(mktemp -d)"
mkdir -p "$tmp_dir/contracts"
cp docs/audits/quantstamp-source/contracts/UniswapV3Pool.sol "$tmp_dir/contracts/"
git -C "$tmp_dir" apply "$repo_root/verification/quantstamp/post-audit-documentation.patch"
cmp "$tmp_dir/contracts/UniswapV3Pool.sol" contracts/UniswapV3Pool.sol \
  || fail "current pool is not audited source plus the checked documentation patch"
echo "ok: current pool equals audited source plus documentation patch"

sha256sum --check verification/quantstamp/SHA256SUMS

if git rev-parse --verify HEAD >/dev/null 2>&1; then
  git diff --quiet HEAD -- contracts || fail "tracked contracts have uncommitted changes"
  public_contracts_tree="$(git rev-parse HEAD:contracts)"
  expect_equal "$public_contracts_tree" "887c39a1cfe71867a07a9df99801a37bb98a81ae" "public contracts tree"
fi

echo "Quantstamp source correspondence verified."
