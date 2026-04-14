import '@nomicfoundation/hardhat-chai-matchers';
import '@nomicfoundation/hardhat-ethers';
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-ignition-ethers";
import '@typechain/hardhat';
import dotenv from "dotenv";
import { HardhatUserConfig } from "hardhat/config";
dotenv.config();

const envAccounts = (privateKey?: string) => privateKey ? [privateKey] : [];

const config: HardhatUserConfig = {
    defaultNetwork: 'hardhat',
    solidity: {
        version: "0.8.20",
        settings: {
            optimizer: {
                enabled: true,
                runs: 200
            },
            viaIR: true
        }
    },
    networks: {
        polygon: {
            url: process.env.POLYGON_RPC_URL || '',
            accounts: envAccounts(process.env.POLYGON_DEPLOYMENT_PRIVATE_KEY)
        },
        amoy: {
            url: process.env.AMOY_RPC_URL || '',
            accounts: envAccounts(process.env.POLYGON_DEPLOYMENT_PRIVATE_KEY)
        },
        base: {
            url: process.env.BASE_RPC_URL || '',
            accounts: envAccounts(process.env.BASE_DEPLOYMENT_PRIVATE_KEY)
        }, 
        baseSepolia: {
            url: process.env.BASE_SEPOLIA_RPC_URL || '',
            accounts: envAccounts(process.env.BASE_DEPLOYMENT_PRIVATE_KEY)
        }
    },
    etherscan: {
        apiKey: process.env.POLYGONSCAN_API_KEY || '',
        customChains: [
            {
                network: "amoy",
                chainId: 80002,
                urls: {
                apiURL: "https://api-amoy.polygonscan.com/api",
                browserURL: "https://amoy.polygonscan.com"
                },
            },
            {
                network: "baseSepolia",
                chainId: 84532,
                urls: {
                    apiURL: "https://api-sepolia.basescan.org/api",
                    browserURL: "https://sepolia.basescan.org"
                },
            }, 
            {
                network: "base",
                chainId: 8453,
                urls: {
                    apiURL: "https://api.basescan.org/api",
                    browserURL: "https://basescan.org"
                },
            },
            {
                network: "polygon",
                chainId: 137,
                urls: {
                    apiURL: "https://api.polygonscan.com/api",
                    browserURL: "https://polygonscan.com"
                },
            }
        ]
    },
    paths: {
        artifacts: "./artifacts",
        cache: "./cache",
        sources: "./contracts",
        tests: "./test",
    },
    typechain: {
        outDir: 'src/types',
        target: 'ethers-v6',
        alwaysGenerateOverloads: false,
        externalArtifacts: ['externalArtifacts/*.json'],
        dontOverrideCompile: false
    },
    sourcify: {
        enabled: true
        }
};

export default config;
