# TapirUniswapV3

This repository implements a modified fork of Uniswap V3. The core changes are as follows:
1. **Designation of tapirAdmin**: A tapirAdmin address can be defined at pool creation, enabling the privileged actions outlined in #2 and #3.
2. **Dynamic Fees**: The fees charged by the pool can be changed by the tapirAdmin
3. **Pausing State**: The pool state can be changed to paused(true) by the tapirAdmin

## Additional Features

### Dynamic Fees
Each pool stores an internal dynamic fee that can be modified by the tapirAdmin. The dynamic fee is initialised to the default fee specified at construction. The tapirAdmin can change the fee at any time by calling `setFee(uint24 newFee)`.

Dynamic fees are defined as `uint24` pips. `setFee()` accepts values from 0 to 10,000 pips (0% to 1%) and reverts with `FTL` above 10,000. At construction, `dynamicFee` is initialized from the factory-enabled immutable `fee`; the factory can enable identifier fee tiers below 1,000,000 pips, so a newly created pool can start above the later `setFee()` cap. When a swap occurs, the pool uses the current value of the dynamic fee for calculations.

**Key Functions:**
- `dynamicFee()`: View function that returns the current dynamic fee
- `setFee(uint24 newFee)`: Admin-only function to update the fee (emits `SetFee` event)

### Pausing State
The pool maintains an internal `paused` boolean state variable. Before executing a swap, the pool checks the value of this variable. If it returns true, the swap will revert with `FRZ`. The paused state can be set by the tapirAdmin via the `setPaused(bool _paused)` function. All pools start with `paused=false` by default.

**Key Functions:**
- `paused()`: View function that returns the current paused state
- `setPaused(bool _paused)`: Admin-only function to pause/unpause the pool (emits `SetPaused` event)

**Note:** Liquidity management operations (mint, burn, collect) are not affected by the paused state, allowing users to always manage their positions.

## Interfaces
All interfaces, except for the following remain unmodified:

- `IUniswapV3PoolImmutables.sol`: now includes `tapirAdmin()` view function which returns the address of the tapirAdmin
- `IUniswapV3PoolState.sol`: now includes `dynamicFee()` and `paused()` view functions for reading current pool state
- `IUniswapV3PoolOwnerActions.sol`: now includes `setFee(uint24)` and `setPaused(bool)` functions for tapirAdmin control
- `IUniswapV3PoolEvents.sol`: now includes `SetFee` and `SetPaused` events
- `IUniswapV3Factory.sol`: the `createPool` function includes a fourth parameter, `tapirAdmin`, an address that is stored immutably in the deployed Uniswap pool
- `IUniswapV3PoolDeployer.sol`: the parameters have been updated to reflect the addition of the `tapirAdmin` parameter

## Day-to-day interactions
Routers and low-level day-to-day interactions such as swaps and liquidity modifications are as in the vanilla Uniswap V3. Integrators should, however, be aware of the potential revert conditions introduced by the dynamic fees and pausing conditions:

- **Dynamic Fees**: Slippage calculations must be performed using the current fee (obtained via `pool.dynamicFee()`). If an outdated fee is used, a transaction may revert or cause an unnecessary frontrunning opportunity.
- **Pausing State**: If the pool is set in the `paused` state, swaps will revert with error `FRZ`. Liquidity management (mint, burn, collect) remains available. Check the pool's paused state via `pool.paused()` before submitting swap transactions.
- **Access Control**: Only the designated `tapirAdmin` can modify the fee or paused state. The `tapirAdmin` address is immutable and set at pool creation.

## Tests
We introduce unit tests to ensure that both the core functions and the added features function as expected. These tests are implemented in:
- `test/UniswapV3Pool.tapirAdmin.spec.ts` - Tests for tapirAdmin designation and pool creation
- `test/UniswapV3Pool.dynamicFee.spec.ts` - Tests for dynamic fee functionality and edge cases
- `test/UniswapV3Pool.pause.spec.ts` - Tests for pausing/unpausing functionality

Run the tests with:
```bash
npx hardhat test test/UniswapV3Pool.tapirAdmin.spec.ts
npx hardhat test test/UniswapV3Pool.dynamicFee.spec.ts
npx hardhat test test/UniswapV3Pool.pause.spec.ts
```

Or run all Tapir-specific tests:
```bash
npx hardhat test test/UniswapV3Pool.tapirAdmin.spec.ts test/UniswapV3Pool.dynamicFee.spec.ts test/UniswapV3Pool.pause.spec.ts
```

## Removed Features
Tapir AMM removes the pool-native `flash()` loan function to keep deployed bytecode under the 24 KB limit.

## Known issues
See the [audit overview](audits/README.md), the [Quantstamp report](audits/Tapir_Final_Report_Quantstamp.pdf), and [VERIFICATION.md](../VERIFICATION.md) for operational considerations, audit scope, and source-correspondence limitations.

### Comment drift in the frozen sources

`contracts/` is byte-frozen so that the audit proof in [VERIFICATION.md](../VERIFICATION.md) stays reproducible, which means the following stale comments cannot be corrected in place. None of them affects executable behaviour; this document is authoritative where they disagree.

| Location | Comment says | Code does |
|---|---|---|
| `interfaces/pool/IUniswapV3PoolOwnerActions.sol` (`setFee`) | `newFee` must be `<= 1,000,000` | `setFee()` reverts with `FTL` above 10,000 pips |
| `interfaces/pool/IUniswapV3PoolState.sol` (`paused`) | pausing blocks swaps and mints | only `swap()` is blocked; mint, burn and collect stay open |
| `interfaces/pool/IUniswapV3PoolEvents.sol` (`CollectProtocol`) | two `@param amount0` tags | the second parameter is `amount1` |
| `UniswapV3Pool.sol` (`lock` modifier) | balance checks cover "mint, swap and flash" | `flash()` was removed |
| `UniswapV3Pool.sol` (`SwapCache.swapFee`) | swap fee is "read from depegPool" | it is read from the pool's own `dynamicFee` |
| `contracts/test/MockTimeUniswapV3PoolDeployer.sol` | parameter named `depegPool` | it carries the `tapirAdmin` address |

## Implementation Details

### Access Control
- The `tapirAdmin` address is stored as an immutable variable set at pool creation
- Only the `tapirAdmin` can call `setFee()` and `setPaused()`
- If `tapirAdmin` is set to `address(0)`, no one can modify the dynamic fee or pause state; other Tapir ABI differences, including the removed `flash()` function, remain
- A modifier `onlyTapirAdmin` enforces access control, reverting with `TA` error if unauthorized

### State Variables
- `uint24 public dynamicFee` - The current swap fee in pips (1/1,000,000)
- `bool public paused` - The current paused state of the pool

### Events
- `SetFee(uint24 oldFee, uint24 newFee)` - Emitted when fee is changed
- `SetPaused(bool paused)` - Emitted when paused state is changed

## Oracle Integration

### Dual-Fee System

Tapir pools maintain two fee values:

| Fee Type | Storage | Getter | Purpose |
|----------|---------|--------|---------|
| Identifier Fee | `uint24 public immutable fee` | `fee()` | Pool identification, tick spacing |
| Swap Fee | `uint24 public dynamicFee` | `dynamicFee()` | Actual swap cost calculations |

Notes:

- The `dynamicFee` can change at any time via `setFee()` by the tapirAdmin
- Monitor `SetFee(uint24 oldFee, uint24 newFee)` events for fee changes
- Always fetch `dynamicFee()` fresh before swap transactions to avoid reverts
- The immutable `fee()` will never change after pool deployment

## Considerations
1. Ensure router does not require `flash()` function (removed for size optimization)
2. Frontend integrations should read `dynamicFee()` before each transaction
3. Consider implementing off-chain monitoring for `SetFee` and `SetPaused` events
