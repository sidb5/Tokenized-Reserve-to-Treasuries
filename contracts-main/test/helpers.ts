import { ContractTransaction, toBeHex } from "ethers";
import { BaseContract, Signer } from "ethers";
import { ethers } from "hardhat";


export interface ERC20PermitToken extends BaseContract {
	name(): Promise<string>;
	nonces(owner: string): Promise<bigint>;
	DOMAIN_SEPARATOR(): Promise<string>;
	mint(address: string, amount: bigint): Promise<ContractTransaction>;
	balanceOf(address: string): Promise<bigint>;
}

export const validIPFSCIDv0 = "QmPK1s3pNYLi9ERiq3BDxKa4XosgWwFRQUydHUtz4YgpqB";
export const validIPFSCIDv1 =
	"bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";
export const invalidIPFSCID = "invalid-ipfs-cid";

export const permitTypes = {
	Permit: [
		{ name: "owner", type: "address" },
		{ name: "spender", type: "address" },
		{ name: "value", type: "uint256" },
		{ name: "nonce", type: "uint256" },
		{ name: "deadline", type: "uint256" },
	],
};

export async function getPermitSignature(
	token: ERC20PermitToken,
	owner: Signer,
	spender: string,
	value: bigint,
	deadline = Math.floor(Date.now() / 1000) + 86400
) {
	const nonce = toBeHex(await token.nonces(await owner.getAddress()));
	const chainId = (await ethers.provider.getNetwork()).chainId;
	
	const domain = {
		name: await token.name(),
		version: "1",
		chainId,
		verifyingContract: await token.getAddress(),
	};

	const permitArgs = {
		owner: await owner.getAddress(),
		spender,
		value,
		nonce,
		deadline,
	};

	const rawSignature = await owner.signTypedData(domain, permitTypes, permitArgs);
	const signature = ethers.Signature.from(rawSignature);

	return { signature, deadline };
}

export async function deployContract(contractName: string, args: any[]) {
	const Contract = await ethers.getContractFactory(contractName);
	const contract = (await Contract.deploy(...args)) as unknown as BaseContract;
	await contract.waitForDeployment();
	return contract;
}
