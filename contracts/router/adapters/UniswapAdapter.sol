// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {ISynapse} from "../interfaces/ISynapse.sol";
import {IUniswapV2Factory} from "../interfaces/IUniswapV2Factory.sol";
import {IUniswapV2Pair} from "../interfaces/IUniswapV2Pair.sol";

import {Adapter} from "../Adapter.sol";

import {IERC20} from "@synapseprotocol/sol-lib/contracts/solc8/erc20/IERC20.sol";

contract UniswapAdapter is Adapter {
    IUniswapV2Factory public uniswapV2Factory;

    // storage for already known pairs
    mapping(address => mapping(address => address)) private pairs;

    constructor(
        string memory _name,
        address _uniswapV2FactoryAddress,
        uint256 _swapGasEstimate
    ) Adapter(_name, _swapGasEstimate) {
        uniswapV2Factory = IUniswapV2Factory(_uniswapV2FactoryAddress);
    }

    function _approveIfNeeded(address, uint256) internal virtual override {
        this;
    }

    function _depositAddress(address _tokenIn, address _tokenOut)
        internal
        view
        override
        returns (address)
    {
        return
            pairs[_tokenIn][_tokenOut] == address(0)
                ? uniswapV2Factory.getPair(_tokenIn, _tokenOut)
                : pairs[_tokenIn][_tokenOut];
    }

    function _swap(
        uint256 _amountIn,
        address _tokenIn,
        address _tokenOut,
        address _to
    ) internal virtual override returns (uint256 _amountOut) {
        require(_amountIn != 0, "Insufficient input amount");

        address _pair = _getPair(_tokenIn, _tokenOut);
        require(_pair != address(0), "Swap pool does not exist");

        _amountOut = _getAmountOut(_pair, _tokenIn, _tokenOut, _amountIn);
        (uint256 _amount0Out, uint256 _amount1Out) = _tokenIn < _tokenOut
            ? (uint256(0), _amountOut)
            : (_amountOut, uint256(0));

        IUniswapV2Pair(_pair).swap(_amount0Out, _amount1Out, _to, new bytes(0));
    }

    function _query(
        uint256 _amountIn,
        address _tokenIn,
        address _tokenOut
    ) internal view virtual override returns (uint256 _amountOut) {
        address _pair = _depositAddress(_tokenIn, _tokenOut);
        if (_pair == address(0)) {
            return 0;
        }
        _amountOut = _getAmountOut(_pair, _tokenIn, _tokenOut, _amountIn);
    }

    function _getPair(address _tokenA, address _tokenB)
        internal
        returns (address)
    {
        if (pairs[_tokenA][_tokenB] == address(0)) {
            address _pair = _depositAddress(_tokenA, _tokenB);

            // save the pair address for both A->B and B->A directions
            pairs[_tokenA][_tokenB] = _pair;
            pairs[_tokenB][_tokenA] = _pair;
        }
        return pairs[_tokenA][_tokenB];
    }

    function _getReserves(
        address _pair,
        address _tokenA,
        address _tokenB
    ) internal view returns (uint256 _reserveA, uint256 _reserveB) {
        (uint256 _reserve0, uint256 _reserve1, ) = IUniswapV2Pair(_pair)
        .getReserves();
        (_reserveA, _reserveB) = _tokenA < _tokenB
            ? (_reserve0, _reserve1)
            : (_reserve1, _reserve0);
    }

    function _getAmountOut(
        address _pair,
        address _tokenIn,
        address _tokenOut,
        uint256 _amountIn
    ) internal view returns (uint256 _amountOut) {
        (uint256 _reserveIn, uint256 _reserveOut) = _getReserves(
            _pair,
            _tokenIn,
            _tokenOut
        );
        return _getAmountOut(_amountIn, _reserveIn, _reserveOut);
    }

    // given an input amount of an asset and pair reserves, returns the maximum output amount of the other asset
    function _getAmountOut(
        uint256 _amountIn,
        uint256 _reserveIn,
        uint256 _reserveOut
    ) internal pure returns (uint256 _amountOut) {
        require(_amountIn > 0, "INSUFFICIENT_INPUT_AMOUNT");
        require(_reserveIn > 0 && _reserveOut > 0, "INSUFFICIENT_LIQUIDITY");
        uint256 amountInWithFee = _amountIn * 997;
        uint256 numerator = amountInWithFee * _reserveOut;
        uint256 denominator = _reserveIn * 1000 + amountInWithFee;

        _amountOut = numerator / denominator;
    }
}