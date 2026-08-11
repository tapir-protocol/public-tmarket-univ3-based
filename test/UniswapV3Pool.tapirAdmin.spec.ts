import { Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { TestERC20 } from '../typechain/TestERC20'
import { UniswapV3Factory } from '../typechain/UniswapV3Factory'
import { UniswapV3Pool } from '../typechain/UniswapV3Pool'
import { expect } from './shared/expect'
import { poolFixture } from './shared/fixtures'

const { constants } = ethers

const createFixtureLoader = waffle.createFixtureLoader

describe('UniswapV3Pool TapirAdmin', () => {
  let wallet: Wallet, other: Wallet, tapirAdminAddress: Wallet, anotherTapirAdmin: Wallet

  let factory: UniswapV3Factory
  let token0: TestERC20
  let token1: TestERC20
  let pool: UniswapV3Pool

  let loadFixture: ReturnType<typeof createFixtureLoader>

  before('create fixture loader', async () => {
    ;[wallet, other, tapirAdminAddress, anotherTapirAdmin] = await (ethers as any).getSigners()
    loadFixture = createFixtureLoader([wallet, other, tapirAdminAddress, anotherTapirAdmin])
  })

  beforeEach('deploy fixture', async () => {
    ;({ factory, token0, token1 } = await loadFixture(poolFixture))
  })

  describe('#createPool with tapirAdmin', () => {
    it('creates pool with specified tapirAdmin address', async () => {
      await factory.createPool(token0.address, token1.address, 3000, tapirAdminAddress.address)
      const poolAddress = await factory.getPool(token0.address, token1.address, 3000)
      
      const poolFactory = await ethers.getContractFactory('UniswapV3Pool')
      pool = poolFactory.attach(poolAddress) as unknown as UniswapV3Pool
      
      expect(await pool.tapirAdmin()).to.eq(tapirAdminAddress.address)
    })

    it('creates pool with zero address as tapirAdmin', async () => {
      await factory.createPool(token0.address, token1.address, 3000, constants.AddressZero)
      const poolAddress = await factory.getPool(token0.address, token1.address, 3000)
      
      const poolFactory = await ethers.getContractFactory('UniswapV3Pool')
      pool = poolFactory.attach(poolAddress) as unknown as UniswapV3Pool
      
      expect(await pool.tapirAdmin()).to.eq(constants.AddressZero)
    })

    it('creates pool with deployer as tapirAdmin', async () => {
      await factory.createPool(token0.address, token1.address, 3000, wallet.address)
      const poolAddress = await factory.getPool(token0.address, token1.address, 3000)
      
      const poolFactory = await ethers.getContractFactory('UniswapV3Pool')
      pool = poolFactory.attach(poolAddress) as unknown as UniswapV3Pool
      
      expect(await pool.tapirAdmin()).to.eq(wallet.address)
    })

    it('different pools can have different tapirAdmin addresses', async () => {
      // Create first pool with one tapirAdmin address
      await factory.createPool(token0.address, token1.address, 500, tapirAdminAddress.address) // Note: the fee has to be different for each pool; otherwise creation will revert
      const pool1Address = await factory.getPool(token0.address, token1.address, 500)
      
      const poolFactory = await ethers.getContractFactory('UniswapV3Pool')
      const pool1 = poolFactory.attach(pool1Address) as unknown as UniswapV3Pool
      
      expect(await pool1.tapirAdmin()).to.eq(tapirAdminAddress.address)
      
      // Create second pool with different tapirAdmin address
      await factory.createPool(token0.address, token1.address, 3000, anotherTapirAdmin.address)
      const pool2Address = await factory.getPool(token0.address, token1.address, 3000)
      
      const pool2 = poolFactory.attach(pool2Address) as unknown as UniswapV3Pool
      
      expect(await pool2.tapirAdmin()).to.eq(anotherTapirAdmin.address)
      
      // Verify they are different
      expect(await pool1.tapirAdmin()).to.not.eq(await pool2.tapirAdmin())
    })
  })

  describe('pool attributes are correctly set', () => {
    it('pool has correct factory, tokens, fee, tick spacing, and tapirAdmin', async () => {
      const feeAmount = 3000
      await factory.createPool(token0.address, token1.address, feeAmount, tapirAdminAddress.address)
      const poolAddress = await factory.getPool(token0.address, token1.address, feeAmount)
      
      const poolFactory = await ethers.getContractFactory('UniswapV3Pool')
      pool = poolFactory.attach(poolAddress) as unknown as UniswapV3Pool
      
      expect(await pool.factory()).to.eq(factory.address)
      expect(await pool.token0()).to.eq(token0.address)
      expect(await pool.token1()).to.eq(token1.address)
      expect(await pool.fee()).to.eq(feeAmount)
      expect(await pool.tickSpacing()).to.eq(60) // tick spacing for 3000 fee
      expect(await pool.tapirAdmin()).to.eq(tapirAdminAddress.address)
    })
  })
})

