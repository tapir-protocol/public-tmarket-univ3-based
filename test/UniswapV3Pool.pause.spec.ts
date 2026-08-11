import { BigNumber, Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { MockTimeUniswapV3Pool } from '../typechain/MockTimeUniswapV3Pool'
import { TestERC20 } from '../typechain/TestERC20'
import { TestUniswapV3Callee } from '../typechain/TestUniswapV3Callee'
import { expect } from './shared/expect'
import { poolFixture } from './shared/fixtures'
import { formatPrice } from './shared/format'
import {
  expandTo18Decimals,
  FeeAmount,
  getMinTick,
  getMaxTick,
  encodePriceSqrt,
  TICK_SPACINGS,
  createPoolFunctions,
  MAX_SQRT_RATIO,
  MIN_SQRT_RATIO,
} from './shared/utilities'

const createFixtureLoader = waffle.createFixtureLoader

describe('UniswapV3Pool Pause', () => {
  let wallet: Wallet, other: Wallet

  let token0: TestERC20
  let token1: TestERC20
  let factory: any
  let pool: MockTimeUniswapV3Pool
  let swapTarget: TestUniswapV3Callee

  let loadFixture: ReturnType<typeof createFixtureLoader>

  before('create fixture loader', async () => {
    ;[wallet, other] = await (ethers as any).getSigners()
    loadFixture = createFixtureLoader([wallet, other])
  })

  beforeEach('deploy fixture', async () => {
    const fixtures = await loadFixture(poolFixture)
    token0 = fixtures.token0
    token1 = fixtures.token1
    factory = fixtures.factory
    swapTarget = fixtures.swapTargetCallee
  })

  describe('pool with tapirAdmin', () => {
    beforeEach('initialize pool with tapirAdmin', async () => {
      // Create pool with wallet as tapirAdmin
      const MockTimeUniswapV3PoolDeployerFactory = await ethers.getContractFactory('MockTimeUniswapV3PoolDeployer')
      const mockTimePoolDeployer = await MockTimeUniswapV3PoolDeployerFactory.deploy()

      const tx = await mockTimePoolDeployer.deploy(
        factory.address,
        token0.address,
        token1.address,
        3000,
        TICK_SPACINGS[FeeAmount.MEDIUM],
        wallet.address // wallet is tapirAdmin
      )

      const receipt = await tx.wait()
      const poolAddress = receipt.events?.[0].args?.pool as string

      const MockTimeUniswapV3PoolFactory = await ethers.getContractFactory('MockTimeUniswapV3Pool')
      pool = MockTimeUniswapV3PoolFactory.attach(poolAddress) as unknown as MockTimeUniswapV3Pool

      // Initialize pool at price of 1:1
      await pool.initialize(encodePriceSqrt(1, 1))

      // Mint liquidity
      await token0.approve(swapTarget.address, expandTo18Decimals(1000))
      await token1.approve(swapTarget.address, expandTo18Decimals(1000))

      await swapTarget.mint(
        pool.address,
        wallet.address,
        getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        expandTo18Decimals(100)
      )
    })

    describe('swap pausing', () => {
      it('reverts swap when pool is paused', async () => {
        const poolFunctions = createPoolFunctions({
          swapTarget,
          token0,
          token1,
          pool,
        })

        // Pause the pool via tapirAdmin
        await pool.setPaused(true)
        expect(await pool.paused()).to.eq(true)

        // Attempt swap - should revert
        await expect(poolFunctions.swapExact0For1(expandTo18Decimals(1), wallet.address)).to.be.revertedWith('FRZ')
      })

      it('reverts both swap directions when paused', async () => {
        const poolFunctions = createPoolFunctions({
          swapTarget,
          token0,
          token1,
          pool,
        })

        // Pause the pool
        await pool.setPaused(true)

        // Both directions should revert
        await expect(poolFunctions.swapExact0For1(expandTo18Decimals(1), wallet.address)).to.be.revertedWith('FRZ')
        await expect(poolFunctions.swapExact1For0(expandTo18Decimals(1), wallet.address)).to.be.revertedWith('FRZ')
      })

      it('allows swap when pool is unpaused', async () => {
        const poolFunctions = createPoolFunctions({
          swapTarget,
          token0,
          token1,
          pool,
        })

        // Set to paused and back
        await pool.setPaused(true)
        await pool.setPaused(false)
        expect(await pool.paused()).to.eq(false)

        // Swap should succeed
        await poolFunctions.swapExact0For1(expandTo18Decimals(1), wallet.address)
      })

      it('emits SetPaused event when paused state changes', async () => {
        // Pause the pool
        await expect(pool.setPaused(true))
          .to.emit(pool, 'SetPaused')
          .withArgs(true)

        // Unpause the pool
        await expect(pool.setPaused(false))
          .to.emit(pool, 'SetPaused')
          .withArgs(false)
      })
    })

    describe('mint not affected by pause', () => {
      it('allows mint when pool is paused', async () => {
        // Pause the pool
        await pool.setPaused(true)
        expect(await pool.paused()).to.eq(true)

        // Mint should still succeed (liquidity management not affected by pause)
        await swapTarget.mint(
          pool.address,
          wallet.address,
          getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
          getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
          expandTo18Decimals(1)
        )
      })

      it('allows mint when pool is unpaused', async () => {
        // Set to paused and back
        await pool.setPaused(true)
        await pool.setPaused(false)
        expect(await pool.paused()).to.eq(false)

        // Mint should succeed
        await swapTarget.mint(
          pool.address,
          wallet.address,
          getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
          getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
          expandTo18Decimals(1)
        )
      })
    })

    describe('dynamic pausing', () => {
      it('can be paused and unpaused for swaps', async () => {
        const poolFunctions = createPoolFunctions({
          swapTarget,
          token0,
          token1,
          pool,
        })

        // Start unpaused - swap should work
        await pool.setPaused(false)
        await poolFunctions.swapExact0For1(expandTo18Decimals(1), wallet.address)

        // Pause - swap should fail
        await pool.setPaused(true)
        await expect(poolFunctions.swapExact0For1(expandTo18Decimals(1), wallet.address)).to.be.revertedWith('FRZ')

        // Unpause - swap should work again
        await pool.setPaused(false)
        await poolFunctions.swapExact0For1(expandTo18Decimals(1), wallet.address)
      })

      it('mint works regardless of pause state', async () => {
        // Start unpaused - mint should work
        await pool.setPaused(false)
        await expect(swapTarget.mint(
          pool.address,
          wallet.address,
          getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
          getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
          expandTo18Decimals(1)
        )).to.not.be.reverted

        // Pause - mint should still work (liquidity management not affected by pause)
        await pool.setPaused(true)
        await expect(swapTarget.mint(
          pool.address,
          wallet.address,
          getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
          getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
          expandTo18Decimals(1)
        )).to.not.be.reverted

        // Unpause - mint should still work
        await pool.setPaused(false)
        await swapTarget.mint(
          pool.address,
          wallet.address,
          getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
          getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
          expandTo18Decimals(1)
        )
      })

      it('all operations work together when unpaused', async () => {
        const poolFunctions = createPoolFunctions({
          swapTarget,
          token0,
          token1,
          pool,
        })

        // Ensure pool is not paused
        await pool.setPaused(false)
        expect(await pool.paused()).to.eq(false)

        // All operations should succeed
        await poolFunctions.swapExact0For1(expandTo18Decimals(1), wallet.address)

        await swapTarget.mint(
          pool.address,
          wallet.address,
          getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
          getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
          expandTo18Decimals(1)
        )
      })
    })

    describe('liquidity management not affected by pause', () => {
      it('allows mint when pool is paused', async () => {
        // Pause the pool
        await pool.setPaused(true)

        // Mint should still work (liquidity management not affected by pause)
        await expect(swapTarget.mint(
          pool.address,
          wallet.address,
          getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
          getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
          expandTo18Decimals(1)
        )).to.not.be.reverted
      })

      it('allows burn when pool is paused', async () => {
        // Pause the pool
        await pool.setPaused(true)

        // Burn should still work (liquidity management not affected by pause)
        await pool.burn(
          getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
          getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
          expandTo18Decimals(1)
        )
      })

      it('allows collect when pool is paused', async () => {
        // First burn some liquidity to have tokens to collect
        await pool.burn(
          getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
          getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
          expandTo18Decimals(1)
        )

        // Pause the pool
        await pool.setPaused(true)

        // Collect should still work
        await pool.collect(
          wallet.address,
          getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
          getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
          BigNumber.from(2).pow(128).sub(1),
          BigNumber.from(2).pow(128).sub(1)
        )
      })
    })

    describe('access control', () => {
      it('only tapirAdmin can pause', async () => {
        // Other wallet should not be able to pause
        await expect(pool.connect(other as any).setPaused(true)).to.be.revertedWith('TA')
      })

      it('only tapirAdmin can unpause', async () => {
        // First pause as tapirAdmin
        await pool.setPaused(true)

        // Other wallet should not be able to unpause
        await expect(pool.connect(other as any).setPaused(false)).to.be.revertedWith('TA')
      })
    })
  })

  describe('pool without tapirAdmin', () => {
    beforeEach('initialize pool without tapirAdmin', async () => {
      // Create pool with no tapirAdmin (address(0))
      const MockTimeUniswapV3PoolDeployerFactory = await ethers.getContractFactory('MockTimeUniswapV3PoolDeployer')
      const mockTimePoolDeployer = await MockTimeUniswapV3PoolDeployerFactory.deploy()

      const tx = await mockTimePoolDeployer.deploy(
        factory.address,
        token0.address,
        token1.address,
        3000,
        TICK_SPACINGS[FeeAmount.MEDIUM],
        ethers.constants.AddressZero // No tapirAdmin
      )

      const receipt = await tx.wait()
      const poolAddress = receipt.events?.[0].args?.pool as string

      const MockTimeUniswapV3PoolFactory = await ethers.getContractFactory('MockTimeUniswapV3Pool')
      pool = MockTimeUniswapV3PoolFactory.attach(poolAddress) as unknown as MockTimeUniswapV3Pool

      // Initialize pool at price of 1:1
      await pool.initialize(encodePriceSqrt(1, 1))

      // Mint liquidity
      await token0.approve(swapTarget.address, expandTo18Decimals(1000))
      await token1.approve(swapTarget.address, expandTo18Decimals(1000))

      await swapTarget.mint(
        pool.address,
        wallet.address,
        getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        expandTo18Decimals(100)
      )
    })

    it('swap works when pool is never paused', async () => {
      const poolFunctions = createPoolFunctions({
        swapTarget,
        token0,
        token1,
        pool,
      })

      // Pool starts unpaused by default
      expect(await pool.paused()).to.eq(false)

      // Swap should work
      await poolFunctions.swapExact0For1(expandTo18Decimals(1), wallet.address)
    })

    it('mint works when pool is never paused', async () => {
      // Pool starts unpaused by default
      expect(await pool.paused()).to.eq(false)

      // Mint should work
      await swapTarget.mint(
        pool.address,
        wallet.address,
        getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        expandTo18Decimals(1)
      )
    })
  })
})
