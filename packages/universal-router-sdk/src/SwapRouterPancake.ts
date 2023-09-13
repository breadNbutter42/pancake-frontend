import { Fraction, ONE, Currency as PancakeCurrency, CurrencyAmount, Percent, TradeType, ZERO } from '@pancakeswap/sdk'
import { SmartRouterTrade } from '@pancakeswap/smart-router/dist/evm/index'
import { abi } from '@uniswap/universal-router/artifacts/contracts/UniversalRouter.sol/UniversalRouter.json'
import BigNumber from 'bignumber.js';
import invariant from 'tiny-invariant'
import { PancakeSwapOptions } from '../test/utils/pancakeswapData'
import { PanckeSwapTrade } from './entities/protocols/pancakeswap'
import { maximumAmountIn } from './utils/utils'
import { encodePermit } from './utils/inputTokens'
import { RoutePlanner } from './utils/routerCommands'
import { encodeFunctionData } from 'viem'
import { MethodParameters } from '@pancakeswap/v3-sdk';

export type SwapRouterConfig = {
  sender?: string // address
  deadline?: BigNumber | undefined
}

export abstract class PancakeUniSwapRouter {
  /**
   * Produces the on-chain method name to call and the hex encoded parameters to pass as arguments for a given trade.
   * @param trades to produce call parameters for
   * @param options options for the call parameters
   */
  public static swapERC20CallParameters(
    trades: SmartRouterTrade<TradeType>,
    options: PancakeSwapOptions
  ): MethodParameters {
    // TODO: use permit if signature included in swapOptions
    const planner = new RoutePlanner()

    const trade: PanckeSwapTrade = new PanckeSwapTrade(trades, options)
    const tradess = !Array.isArray(trade.trade) ? [trade.trade] : trade.trade
    const sampleTrade = tradess[0]

    const inputCurrency = sampleTrade.inputAmount.currency
    invariant(!(inputCurrency.isNative && !!options.inputTokenPermit), 'NATIVE_INPUT_PERMIT')

    if (options.inputTokenPermit) {
      encodePermit(planner, options.inputTokenPermit)
    }

    const nativeCurrencyValue = inputCurrency.isNative
      ? new BigNumber(maximumAmountIn(sampleTrade, options.slippageTolerance, sampleTrade.inputAmount).quotient.toString())
      : new BigNumber(0);
    

    trade.encode(planner, { allowRevert: false })
    return PancakeUniSwapRouter.encodePlan(planner, nativeCurrencyValue, {
      deadline: options.deadlineOrPreviousBlockhash ? new BigNumber(options.deadlineOrPreviousBlockhash.toString()) : undefined,
    })
  }

  public static minimumAmountOut(slippageTolerance: Percent, amountOut: CurrencyAmount<PancakeCurrency>, tradeType: TradeType): CurrencyAmount<PancakeCurrency> {
      invariant(!slippageTolerance.lessThan(ZERO), 'SLIPPAGE_TOLERANCE')
      if (tradeType === TradeType.EXACT_OUTPUT) {
        return amountOut
      }
      const slippageAdjustedAmountOut = new Fraction(ONE)
        .add(slippageTolerance)
        .invert()
        .multiply(amountOut.quotient).quotient
      return CurrencyAmount.fromRawAmount(amountOut.currency, slippageAdjustedAmountOut)
    }
  
    /**
     * Get the maximum amount in that can be spent via this trade for the given slippage tolerance
     * @param slippageTolerance The tolerance of unfavorable slippage from the execution price of this trade
     * @returns The amount in
     */
    public static maximumAmountIn(slippageTolerance: Percent, amountIn: CurrencyAmount<PancakeCurrency>, tradeType: TradeType): CurrencyAmount<PancakeCurrency> {
      invariant(!slippageTolerance.lessThan(ZERO), 'SLIPPAGE_TOLERANCE')
      if (tradeType === TradeType.EXACT_INPUT) {
        return amountIn
      }
      const slippageAdjustedAmountIn = new Fraction(ONE).add(slippageTolerance).multiply(amountIn.quotient).quotient
      return CurrencyAmount.fromRawAmount(amountIn.currency, slippageAdjustedAmountIn)
    }

  /**
   * Encodes a planned route into a method name and parameters for the Router contract.
   * @param planner the planned route
   * @param nativeCurrencyValue the native currency value of the planned route
   * @param config the router config
   */
  private static encodePlan(
    planner: RoutePlanner,
    nativeCurrencyValue: BigNumber,
    config: SwapRouterConfig = {}
  ): MethodParameters {
    const { commands, inputs } = planner
    //view encodeFunctionData doesnt take in signature only name. so not sure how to handle this, perhaps solft 
    //fix is to force a deadline to be passed in SwapRouterConfig
    const functionSignature = !!config.deadline ? 'execute(bytes,bytes[],uint256)' : 'execute(bytes,bytes[])'
    const parameters = !!config.deadline ? [commands, inputs, config.deadline] : [commands, inputs]
    const calldata = encodeFunctionData({ abi, args: parameters, functionName: 'execute' })
    return { calldata, value: nativeCurrencyValue.toString() as `0x${string}` }
  }
}
