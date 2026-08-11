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

describe('UniswapV3Pool Dynamic Fee', () => {
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

  describe('swap with dynamic fees', () => {
    beforeEach('initialize pool with dynamic fee', async () => {
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

    it('starts with default fee from constructor', async () => {
      // Pool should start with fee from constructor (3000)
      expect(await pool.dynamicFee()).to.eq(3000)
      expect(await pool.fee()).to.eq(3000)
    })

    it('tapirAdmin can change fee', async () => {
      // Set fee to 5000 (0.5%)
      await expect(pool.setFee(5000))
        .to.emit(pool, 'SetFee')
        .withArgs(3000, 5000)

      // Verify fee changed
      expect(await pool.dynamicFee()).to.eq(5000)
    })

    it('reads dynamic fee during swap', async () => {
      // Set fee to 5000 (0.5%)
      await pool.setFee(5000)

      // Verify fee is correct
      expect(await pool.dynamicFee()).to.eq(5000)

      const poolFunctions = createPoolFunctions({
        swapTarget,
        token0,
        token1,
        pool,
      })

      // Execute swap
      const swapAmount = expandTo18Decimals(1)
      await expect(poolFunctions.swapExact0For1(swapAmount, wallet.address))
        .to.emit(pool, 'Swap')
    })

    it('different fees result in different swap outputs', async () => {
      // Add much more liquidity to minimize price impact and make fee difference more pronounced
      await token0.approve(swapTarget.address, expandTo18Decimals(100000))
      await token1.approve(swapTarget.address, expandTo18Decimals(100000))

      await swapTarget.mint(
        pool.address,
        wallet.address,
        getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        expandTo18Decimals(10000)
      )

      const poolFunctions = createPoolFunctions({
        swapTarget,
        token0,
        token1,
        pool,
      })

      // Use small swap amount relative to liquidity
      const swapAmount = expandTo18Decimals(1).div(100)

      // Get balances before to track outputs
      const balance1Before1 = await token1.balanceOf(wallet.address)

      // Swap with 10000 fee (1% - max allowed)
      await pool.setFee(10000)
      await poolFunctions.swapExact0For1(swapAmount, wallet.address)
      
      const balance1After1 = await token1.balanceOf(wallet.address)
      const amount1Out1 = balance1After1.sub(balance1Before1)

      // Reset pool state by swapping back
      await poolFunctions.swapExact1For0(amount1Out1, wallet.address)

      // Get balances for second swap
      const balance1Before2 = await token1.balanceOf(wallet.address)

      // Swap with 100 fee (0.01%) - lower fee should give more output
      await pool.setFee(100)
      await poolFunctions.swapExact0For1(swapAmount, wallet.address)

      const balance1After2 = await token1.balanceOf(wallet.address)
      const amount1Out2 = balance1After2.sub(balance1Before2)

      // Lower fee (100) should result in more output than higher fee (10000)
      expect(amount1Out2).to.be.gt(amount1Out1)
    })

    it('fee changes between swaps are reflected', async () => {
      const poolFunctions = createPoolFunctions({
        swapTarget,
        token0,
        token1,
        pool,
      })

      const swapAmount = expandTo18Decimals(1)

      // Track balance for first swap
      const balance1Before1 = await token1.balanceOf(wallet.address)

      // First swap with 3000 fee
      await pool.setFee(3000)
      await poolFunctions.swapExact0For1(swapAmount, wallet.address)

      const balance1After1 = await token1.balanceOf(wallet.address)
      const amount1Out1 = balance1After1.sub(balance1Before1)

      // Change fee to 5000
      await pool.setFee(5000)
      expect(await pool.dynamicFee()).to.eq(5000)

      // Track balance for second swap (swapping back same direction to compare)
      const balance1Before2 = await token1.balanceOf(wallet.address)

      // Second swap with 5000 fee - should get less output due to higher fee
      await poolFunctions.swapExact0For1(swapAmount, wallet.address)

      const balance1After2 = await token1.balanceOf(wallet.address)
      const amount1Out2 = balance1After2.sub(balance1Before2)

      // Higher fee (5000) should result in less output than lower fee (3000)
      expect(amount1Out2).to.be.lt(amount1Out1)
    })

    it('fee calculation is precise in selected hardcoded test cases', async () => {
      const poolFunctions = createPoolFunctions({
        swapTarget,
        token0,
        token1,
        pool,
      })
      
      // Add MASSIVE liquidity to minimize price impact (10,000x more than normal)
      await token0.approve(swapTarget.address, expandTo18Decimals(100000))
      await token1.approve(swapTarget.address, expandTo18Decimals(100000))
      
      await swapTarget.mint(
        pool.address,
        wallet.address,
        getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        expandTo18Decimals(10000) // 100x more liquidity
      )

      // Use a TINY swap amount relative to liquidity (0.001 instead of 1)
      const swapAmount = expandTo18Decimals(1).div(1000)

      // TEST CASE 1: Swap with 3000 fee (0.3%)
      //////////////////////////////////////////////////////////////
      await pool.setFee(3000)

      const balance1Before = await token1.balanceOf(wallet.address)
      await poolFunctions.swapExact0For1(swapAmount, wallet.address)
      const balance1After = await token1.balanceOf(wallet.address)
      
      const actualOutput = balance1After.sub(balance1Before)

      // Expected: input - fee (with minimal price impact)
      const expectedFee = swapAmount.mul(3000).div(1_000_000) // 0.3% fee
      const expectedOutput = swapAmount.sub(expectedFee)

      // With high liquidity and tiny swap, output should be within a small tolerance of expected
      const tolerance = expectedOutput.div(100_00) // 1bp tolerance
      const difference = actualOutput.sub(expectedOutput).abs()
      
      expect(difference).to.be.lte(tolerance)

      // TEST CASE 2: Swap with 100 fee (0.01%)
      //////////////////////////////////////////////////////////////
      await pool.setFee(100)

      const tc2_balance1Before = await token1.balanceOf(wallet.address)
      await poolFunctions.swapExact0For1(swapAmount, wallet.address)
      const tc2_balance1After = await token1.balanceOf(wallet.address)
      
      const tc2_actualOutput = tc2_balance1After.sub(tc2_balance1Before)

      const tc2_expectedFee = swapAmount.mul(100).div(1_000_000) // 0.01% fee
      const tc2_expectedOutput = swapAmount.sub(tc2_expectedFee)

      const tc2_tolerance = tc2_expectedOutput.div(100_00) // 1bp tolerance
      const tc2_difference = tc2_actualOutput.sub(tc2_expectedOutput).abs()
      
      expect(tc2_difference).to.be.lte(tc2_tolerance)

      // TEST CASE 3: Swap with 10000 fee (1%)
      //////////////////////////////////////////////////////////////
      await pool.setFee(10000)

      const tc3_balance1Before = await token1.balanceOf(wallet.address)
      await poolFunctions.swapExact0For1(swapAmount, wallet.address)
      const tc3_balance1After = await token1.balanceOf(wallet.address)

      const tc3_actualOutput = tc3_balance1After.sub(tc3_balance1Before)

      const tc3_expectedFee = swapAmount.mul(10000).div(1_000_000) // 1% fee
      const tc3_expectedOutput = swapAmount.sub(tc3_expectedFee)

      const tc3_tolerance = tc3_expectedOutput.div(100_00) // 1bp tolerance
      const tc3_difference = tc3_actualOutput.sub(tc3_expectedOutput).abs()
      
      expect(tc3_difference).to.be.lte(tc3_tolerance)
    })

    it('reverts when fee exceeds maximum (10,000 = 1%)', async () => {
      // Set fee above maximum (10,000 pips = 1%)
      await expect(pool.setFee(10001)).to.be.revertedWith('FTL')
    })

    it('accepts maximum fee (10,000 = 1%)', async () => {
      // Set fee to 10,000 (1%) - the maximum allowed
      await pool.setFee(10000)

      const poolFunctions = createPoolFunctions({
        swapTarget,
        token0,
        token1,
        pool,
      })

      // Add more liquidity for precise fee calculation
      await token0.approve(swapTarget.address, expandTo18Decimals(10000))
      await token1.approve(swapTarget.address, expandTo18Decimals(10000))
      
      await swapTarget.mint(
        pool.address,
        wallet.address,
        getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        expandTo18Decimals(1000)
      )

      const balance1Before = await token1.balanceOf(wallet.address)

      const swapAmount = expandTo18Decimals(1).div(1000) // Small swap for precision

      // Should succeed with maximum fee
      await expect(poolFunctions.swapExact0For1(swapAmount, wallet.address))
        .to.emit(pool, 'Swap')

      const balance1After = await token1.balanceOf(wallet.address)
      const actualOutput = balance1After.sub(balance1Before)

      const expectedFee = swapAmount.mul(10000).div(1_000_000) // 1% fee
      const expectedOutput = swapAmount.sub(expectedFee)

      const tolerance = expectedOutput.div(10000) // 1bp tolerance
      const difference = actualOutput.sub(expectedOutput).abs()
      expect(difference).to.be.lte(tolerance)
    })

    it('accepts zero fee', async () => {
      // Set fee to 0
      await pool.setFee(0)

      const poolFunctions = createPoolFunctions({
        swapTarget,
        token0,
        token1,
        pool,
      })

      const swapAmount = expandTo18Decimals(1)

      // Should succeed with no fees
      await expect(poolFunctions.swapExact0For1(swapAmount, wallet.address))
        .to.emit(pool, 'Swap')
    })

    it('dynamic fee works in a multi-tick swap', async () => {
      // Set a specific fee
      await pool.setFee(5000)

      const poolFunctions = createPoolFunctions({
        swapTarget,
        token0,
        token1,
        pool,
      })

      // Large swap that crosses multiple ticks
      const largeSwapAmount = expandTo18Decimals(1000)

      await expect(poolFunctions.swapExact0For1(largeSwapAmount, wallet.address))
        .to.emit(pool, 'Swap')      
    })

    it('handles multiple swaps with changing fees', async () => {
      const poolFunctions = createPoolFunctions({
        swapTarget,
        token0,
        token1,
        pool,
      })

      const swapAmount = expandTo18Decimals(1)

      // Swap 1: 1000 fee
      await pool.setFee(1000)
      await poolFunctions.swapExact0For1(swapAmount, wallet.address)

      // Swap 2: 3000 fee
      await pool.setFee(3000)
      await poolFunctions.swapExact1For0(swapAmount, wallet.address)

      // Swap 3: 5000 fee
      await pool.setFee(5000)
      await poolFunctions.swapExact0For1(swapAmount, wallet.address)

      // Verify final fee is 5000
      expect(await pool.dynamicFee()).to.eq(5000)
    })
  })

  describe('access control', () => {
    beforeEach('initialize pool', async () => {
      const MockTimeUniswapV3PoolDeployerFactory = await ethers.getContractFactory('MockTimeUniswapV3PoolDeployer')
      const mockTimePoolDeployer = await MockTimeUniswapV3PoolDeployerFactory.deploy()

      const tx = await mockTimePoolDeployer.deploy(
        factory.address,
        token0.address,
        token1.address,
        FeeAmount.MEDIUM,
        TICK_SPACINGS[FeeAmount.MEDIUM],
        wallet.address
      )

      const receipt = await tx.wait()
      const poolAddress = receipt.events?.[0].args?.pool as string

      const MockTimeUniswapV3PoolFactory = await ethers.getContractFactory('MockTimeUniswapV3Pool')
      pool = MockTimeUniswapV3PoolFactory.attach(poolAddress) as unknown as MockTimeUniswapV3Pool

      await pool.initialize(encodePriceSqrt(1, 1))
    })

    it('only tapirAdmin can set fee', async () => {
      // Other wallet should not be able to set fee
      await expect(pool.connect(other as any).setFee(5000)).to.be.revertedWith('TA')
    })

    it('tapirAdmin can set fee', async () => {
      // Wallet (tapirAdmin) should be able to set fee
      await expect(pool.setFee(5000))
        .to.emit(pool, 'SetFee')
        .withArgs(3000, 5000)
    })
  })

  describe('pool without tapirAdmin', () => {
    beforeEach('initialize pool without tapirAdmin', async () => {
      // Create pool with no tapirAdmin (address zero) using deployer
      const MockTimeUniswapV3PoolDeployerFactory = await ethers.getContractFactory('MockTimeUniswapV3PoolDeployer')
      const mockTimePoolDeployer = await MockTimeUniswapV3PoolDeployerFactory.deploy()

      const tx = await mockTimePoolDeployer.deploy(
        factory.address,
        token0.address,
        token1.address,
        FeeAmount.MEDIUM,
        TICK_SPACINGS[FeeAmount.MEDIUM],
        ethers.constants.AddressZero // No tapirAdmin
      )

      const receipt = await tx.wait()
      const poolAddress = receipt.events?.[0].args?.pool as string

      const MockTimeUniswapV3PoolFactory = await ethers.getContractFactory('MockTimeUniswapV3Pool')
      pool = MockTimeUniswapV3PoolFactory.attach(poolAddress) as unknown as MockTimeUniswapV3Pool

      // Verify tapirAdmin is address zero
      expect(await pool.tapirAdmin()).to.eq(ethers.constants.AddressZero)

      // Initialize pool
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

    it('uses immutable fee as default', async () => {
      // Pool should use the fee from constructor
      expect(await pool.dynamicFee()).to.eq(FeeAmount.MEDIUM)
      expect(await pool.fee()).to.eq(FeeAmount.MEDIUM)
    })

    it('swap works with default fee', async () => {
      const poolFunctions = createPoolFunctions({
        swapTarget,
        token0,
        token1,
        pool,
      })

      const swapAmount = expandTo18Decimals(1)

      // Should work with immutable fee
      await expect(poolFunctions.swapExact0For1(swapAmount, wallet.address))
        .to.emit(pool, 'Swap')
    })
  })
})
