// @ts-nocheck

import {ethers, network } from "hardhat"

export async function setBalance(userAddress, tokenAddress, amount, storage = 0) {
	const encode = (types, values) =>   
	  ethers.utils.defaultAbiCoder.encode(types, values);
  
	const index = ethers.utils.solidityKeccak256(
	  ["uint256", "uint256"],
	  [userAddress, storage] // slot = 0 for bridged tokens on Avalanche
	);
  
	await network.provider.send("hardhat_setStorageAt", [
	  tokenAddress,
	  index.toString(),
	  encode(['uint'], [amount])
	]);
}