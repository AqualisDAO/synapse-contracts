//@ts-nocheck
import { BigNumber, Signer } from "ethers"
import { MAX_UINT256, getUserTokenBalance } from "../../../amm/testUtils"
import { solidity } from "ethereum-waffle"
import { deployments } from "hardhat"

import { TestAdapterSwap } from "../build/typechain/TestAdapterSwap"
import { IERC20 } from "../../../../build/typechain/IERC20"
import { CurveBasePoolAdapter } from "../../../../build/typechain/CurveBasePoolAdapter"
import chai from "chai"
import { getBigNumber } from "../../../bridge/utilities"
import { setBalance } from "../../utils/helpers"

import config from "../../../config.json"

chai.use(solidity)
const { expect } = chai

describe("Curve 3pool (ETH) Adapter", async () => {
  let signers: Array<Signer>

  let owner: Signer
  let ownerAddress: string
  let dude: Signer
  let dudeAddress: string

  let curveBasePoolAdapter: CurveBasePoolAdapter

  let testAdapterSwap: TestAdapterSwap

  // Test Values
  const TOKENS: IERC20[] = []

  const CHAIN = 1
  const DEX = "curve"

  const TOKENS_DECIMALS = []
  const tokenSymbols = ["DAI", "USDC", "USDT"]

  const DIRECT_SWAP_SUPPORTED = false
  
  const range = (n) => Array.from({ length: n }, (value, key) => key)
  const ALL_TOKENS = range(tokenSymbols.length)

  const AMOUNTS = [8, 1001, 96420, 1337000]
  const AMOUNTS_BIG = [10200300, 200300400, 100900800700]
  const CHECK_UNDERQUOTING = true

  async function testAdapter(
    adapter: Adapter,
    tokensFrom: Array<number>,
    tokensTo: Array<number>,
    times = 1,
    amounts = AMOUNTS,
    tokens = TOKENS,
    decimals = TOKENS_DECIMALS,
  ) {
    let swapsAmount = 0
    for (var k = 0; k < times; k++)
      for (let i of tokensFrom) {
        let tokenFrom = tokens[i]
        let decimalsFrom = decimals[i]
        for (let j of tokensTo) {
          if (i == j) {
            continue
          }
          let tokenTo = tokens[j]
          for (let amount of amounts) {
            swapsAmount++
            await testAdapterSwap.testSwap(
              adapter.address,
              getBigNumber(amount, decimalsFrom),
              tokenFrom.address,
              tokenTo.address,
              CHECK_UNDERQUOTING,
              swapsAmount,
            )
          }
        }
      }
  }

  const setupTest = deployments.createFixture(
    async ({ deployments, ethers }) => {
      const { get } = deployments
      await deployments.fixture() // ensure you start from a fresh deployments

      TOKENS.length = 0
      signers = await ethers.getSigners()
      owner = signers[0]
      ownerAddress = await owner.getAddress()
      dude = signers[1]
      dudeAddress = await dude.getAddress()

      const testFactory = await ethers.getContractFactory("TestAdapterSwap")

      // we expect the quory to underQuote by 1 at maximum
      testAdapterSwap = (await testFactory.deploy(1)) as TestAdapterSwap

      for (let symbol of tokenSymbols) {
        let tokenAddress = config[CHAIN].assets[symbol]
        let storageSlot = config[CHAIN].slot[symbol]
        let token = (await ethers.getContractAt(
          "contracts/amm/SwapCalculator.sol:IERC20Decimals",
          tokenAddress,
        )) as IERC20Decimals
        TOKENS.push(token)
        let decimals = await token.decimals()
        TOKENS_DECIMALS.push(decimals)
        let amount = getBigNumber(1e12, decimals)
        await setBalance(ownerAddress, tokenAddress, amount, storageSlot)
        expect(await getUserTokenBalance(ownerAddress, token)).to.eq(amount)
      }

      const curveAdapterFactory = await ethers.getContractFactory(
        "CurveBasePoolAdapter",
      )

      curveBasePoolAdapter = (await curveAdapterFactory.deploy(
        "CurveBaseAdapter",
        config[CHAIN][DEX].basepool,
        160000,
        DIRECT_SWAP_SUPPORTED
      )) as CurveBasePoolAdapter

      for (let token of TOKENS) {
        await token.approve(testAdapterSwap.address, MAX_UINT256)
      }
    },
  )

  before(async () => {
    console.log("Direct swaps = %s", DIRECT_SWAP_SUPPORTED)
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.ALCHEMY_API,
            blockNumber: 14000000, // 2022-01-13
          },
        },
      ],
    })
  })

  beforeEach(async () => {
    await setupTest()
  })

  describe("Sanity checks", () => {
    it("Curve Adapter is properly set up", async () => {
      expect(await curveBasePoolAdapter.pool()).to.eq(
        config[CHAIN][DEX].basepool,
      )

      for (let i in TOKENS) {
        let token = TOKENS[i].address
        expect(await curveBasePoolAdapter.isPoolToken(token))
        expect(await curveBasePoolAdapter.tokenIndex(token)).to.eq(+i)
      }
    })

    it("Swap fails if transfer amount is too little", async () => {
      let amount = getBigNumber(10, TOKENS_DECIMALS[0])
      let depositAddress = await curveBasePoolAdapter.depositAddress(
        TOKENS[0].address,
        TOKENS[1].address,
      )
      TOKENS[0].transfer(depositAddress, amount.sub(1))
      await expect(
        curveBasePoolAdapter.swap(
          amount,
          TOKENS[0].address,
          TOKENS[1].address,
          ownerAddress,
        ),
      ).to.be.reverted
    })

    it("Only Owner can rescue overprovided swap tokens", async () => {
      let amount = getBigNumber(10, TOKENS_DECIMALS[0])
      let extra = getBigNumber(42, TOKENS_DECIMALS[0] - 1)
      let depositAddress = await curveBasePoolAdapter.depositAddress(
        TOKENS[0].address,
        TOKENS[1].address,
      )
      TOKENS[0].transfer(depositAddress, amount.add(extra))
      await curveBasePoolAdapter.swap(
        amount,
        TOKENS[0].address,
        TOKENS[1].address,
        ownerAddress,
      )

      await expect(
        curveBasePoolAdapter
          .connect(dude)
          .recoverERC20(TOKENS[0].address, extra),
      ).to.be.revertedWith("Ownable: caller is not the owner")

      await expect(() =>
        curveBasePoolAdapter.recoverERC20(TOKENS[0].address, extra),
      ).to.changeTokenBalance(TOKENS[0], owner, extra)
    })

    it("Anyone can take advantage of overprovided swap tokens", async () => {
      let amount = getBigNumber(10, TOKENS_DECIMALS[0])
      let extra = getBigNumber(42, TOKENS_DECIMALS[0] - 1)
      let depositAddress = await curveBasePoolAdapter.depositAddress(
        TOKENS[0].address,
        TOKENS[1].address,
      )
      TOKENS[0].transfer(depositAddress, amount.add(extra))
      await curveBasePoolAdapter.swap(
        amount,
        TOKENS[0].address,
        TOKENS[1].address,
        ownerAddress,
      )

      let swapQuote = await curveBasePoolAdapter.query(
        extra,
        TOKENS[0].address,
        TOKENS[1].address,
      )

      // .add(1) to reflect underquoting by 1
      await expect(() =>
        curveBasePoolAdapter
          .connect(dude)
          .swap(extra, TOKENS[0].address, TOKENS[1].address, dudeAddress),
      ).to.changeTokenBalance(TOKENS[1], dude, swapQuote.add(1))
    })

    it("Only Owner can rescue GAS from Adapter", async () => {
      let amount = 42690
      await expect(() =>
        owner.sendTransaction({
          to: curveBasePoolAdapter.address,
          value: amount,
        }),
      ).to.changeEtherBalance(curveBasePoolAdapter, amount)

      await expect(
        curveBasePoolAdapter.connect(dude).recoverGAS(amount),
      ).to.be.revertedWith("Ownable: caller is not the owner")

      await expect(() =>
        curveBasePoolAdapter.recoverGAS(amount),
      ).to.changeEtherBalances([curveBasePoolAdapter, owner], [-amount, amount])
    })
  })

  describe("Adapter Swaps", () => {
    it("Swaps between tokens [120 small-medium swaps]", async () => {
      await testAdapter(curveBasePoolAdapter, ALL_TOKENS, ALL_TOKENS, 5)
    })

    it("Swaps between tokens [90 big-ass swaps]", async () => {
      await testAdapter(
        curveBasePoolAdapter,
        ALL_TOKENS,
        ALL_TOKENS,
        5,
        AMOUNTS_BIG,
      )
    })
  })
})