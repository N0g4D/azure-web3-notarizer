// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {ConfidentialRWA} from "../src/ConfidentialRWA.sol";

/**
 * Deploy di ConfidentialRWA su Avalanche Fuji.
 *
 * Il wallet del relayer diventa owner del contratto ed è approvato KYC per
 * costruzione, così può emettere e ricevere fin da subito.
 *
 *   export FUJI_PRIVATE_KEY=0x...        # stesso wallet del relayer
 *   forge script script/DeployConfidentialRWA.s.sol \
 *     --rpc-url fuji --broadcast -vvv
 *
 * Serve AVAX di test: https://core.app/tools/testnet-faucet/
 * L'indirizzo stampato va in Blockchain__Networks__43113__ContractAddress.
 */
contract DeployConfidentialRWA is Script {
    function run() external returns (ConfidentialRWA rwa) {
        uint256 deployerKey = vm.envUint("FUJI_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        console.log("Deployer:", deployer);
        console.log("Saldo (wei):", deployer.balance);
        require(deployer.balance > 0, "Wallet senza AVAX: usare il faucet Core");

        vm.startBroadcast(deployerKey);
        rwa = new ConfidentialRWA(deployer);
        vm.stopBroadcast();

        console.log("ConfidentialRWA:", address(rwa));
        console.log("Da mettere in Blockchain__Networks__43113__ContractAddress");
    }
}
