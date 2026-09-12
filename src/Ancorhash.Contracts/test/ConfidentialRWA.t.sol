// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ConfidentialRWA} from "../src/ConfidentialRWA.sol";
import {IERC721Errors} from "openzeppelin-contracts/contracts/interfaces/draft-IERC6093.sol";
import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";

/// @dev Venditore ostile: rifiuta i fondi, per verificare che il DvP sia atomico.
contract RejectingSeller {
    function mint(ConfidentialRWA rwa, bytes32 h, bytes32 s) external {
        rwa.mintNotarization(h, s);
    }
    receive() external payable {
        revert("no");
    }
}

contract ConfidentialRWATest is Test {
    ConfidentialRWA internal rwa;

    address internal bank = address(0xB4);
    address internal buyer = address(0xB5);
    address internal outsider = address(0xB6);

    bytes32 internal constant DOC = keccak256("fattura-q3-2026.pdf");
    bytes32 internal constant SWARM = keccak256("swarm-address");

    function setUp() public {
        vm.prank(bank);
        rwa = new ConfidentialRWA(bank);
        vm.deal(buyer, 1 ether);
        vm.deal(outsider, 1 ether);
    }

    // ------------------------------------------------------------ ASSET RULE

    function test_Mint_DerivesTokenIdFromDocumentHash() public {
        vm.prank(bank);
        uint256 tokenId = rwa.mintNotarization(DOC, SWARM);

        assertEq(tokenId, uint256(DOC), "tokenId deve essere uint256(documentHash)");
        assertEq(rwa.ownerOf(tokenId), bank);
        assertEq(rwa.swarmAddressOf(tokenId), SWARM);
        assertEq(rwa.notarizedAtBlock(tokenId), block.number);
        assertTrue(rwa.isNotarized(DOC));
    }

    /// Il cuore della regola d'asset: lo stesso documento non si notarizza due volte.
    function test_Mint_RevertsOnDuplicateDocument() public {
        vm.startPrank(bank);
        rwa.mintNotarization(DOC, SWARM);

        vm.expectRevert(
            abi.encodeWithSelector(IERC721Errors.ERC721InvalidSender.selector, address(0))
        );
        rwa.mintNotarization(DOC, SWARM);
        vm.stopPrank();
    }

    /// Documenti diversi restano indipendenti anche se emessi dallo stesso conto.
    function test_Mint_DistinctDocumentsGetDistinctTokens() public {
        bytes32 other = keccak256("contratto.pdf");
        vm.startPrank(bank);
        uint256 a = rwa.mintNotarization(DOC, SWARM);
        uint256 b = rwa.mintNotarization(other, SWARM);
        vm.stopPrank();
        assertTrue(a != b);
    }

    function test_Mint_RevertsOnZeroInputs() public {
        vm.startPrank(bank);
        vm.expectRevert(ConfidentialRWA.ZeroDocumentHash.selector);
        rwa.mintNotarization(bytes32(0), SWARM);

        vm.expectRevert(ConfidentialRWA.ZeroSwarmAddress.selector);
        rwa.mintNotarization(DOC, bytes32(0));
        vm.stopPrank();
    }

    // -------------------------------------------------------- TRANSFER POLICY

    function test_Transfer_RevertsWhenRecipientNotKycApproved() public {
        vm.prank(bank);
        uint256 tokenId = rwa.mintNotarization(DOC, SWARM);

        vm.prank(bank);
        vm.expectRevert(
            abi.encodeWithSelector(
                ConfidentialRWA.RecipientNotKycApproved.selector, outsider
            )
        );
        rwa.transferFrom(bank, outsider, tokenId);
    }

    function test_Transfer_SucceedsWhenRecipientApproved() public {
        vm.prank(bank);
        uint256 tokenId = rwa.mintNotarization(DOC, SWARM);

        vm.prank(bank);
        rwa.setKycApproval(buyer, true);

        vm.prank(bank);
        rwa.transferFrom(bank, buyer, tokenId);
        assertEq(rwa.ownerOf(tokenId), buyer);
    }

    /// La policy non si aggira passando dalla variante safe.
    function test_SafeTransfer_AlsoEnforcesPolicy() public {
        vm.prank(bank);
        uint256 tokenId = rwa.mintNotarization(DOC, SWARM);

        vm.prank(bank);
        vm.expectRevert(
            abi.encodeWithSelector(
                ConfidentialRWA.RecipientNotKycApproved.selector, outsider
            )
        );
        rwa.safeTransferFrom(bank, outsider, tokenId);
    }

    function test_Kyc_OnlyOwnerCanApprove() public {
        vm.prank(outsider);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, outsider)
        );
        rwa.setKycApproval(outsider, true);
    }

    function test_Kyc_RevocationBlocksFurtherTransfers() public {
        vm.prank(bank);
        uint256 tokenId = rwa.mintNotarization(DOC, SWARM);

        vm.startPrank(bank);
        rwa.setKycApproval(buyer, true);
        rwa.setKycApproval(buyer, false);
        vm.expectRevert(
            abi.encodeWithSelector(ConfidentialRWA.RecipientNotKycApproved.selector, buyer)
        );
        rwa.transferFrom(bank, buyer, tokenId);
        vm.stopPrank();
    }

    // ------------------------------------------------------------ SETTLEMENT

    function test_Settle_MovesTokenAndFundsAtomically() public {
        vm.startPrank(bank);
        uint256 tokenId = rwa.mintNotarization(DOC, SWARM);
        rwa.setKycApproval(buyer, true);
        vm.stopPrank();

        uint256 sellerBefore = bank.balance;
        uint256 buyerBefore = buyer.balance;

        vm.prank(buyer);
        rwa.settlePurchase{value: 0.01 ether}(tokenId);

        assertEq(rwa.ownerOf(tokenId), buyer, "consegna");
        assertEq(bank.balance, sellerBefore + 0.01 ether, "pagamento al venditore");
        assertEq(buyer.balance, buyerBefore - 0.01 ether, "addebito al compratore");
    }

    function test_Settle_RevertsOnWrongPrice() public {
        vm.startPrank(bank);
        uint256 tokenId = rwa.mintNotarization(DOC, SWARM);
        rwa.setKycApproval(buyer, true);
        vm.stopPrank();

        vm.prank(buyer);
        vm.expectRevert(
            abi.encodeWithSelector(
                ConfidentialRWA.IncorrectSettlementValue.selector, 0.005 ether, 0.01 ether
            )
        );
        rwa.settlePurchase{value: 0.005 ether}(tokenId);
    }

    function test_Settle_RevertsWhenBuyerNotKycApproved() public {
        vm.prank(bank);
        uint256 tokenId = rwa.mintNotarization(DOC, SWARM);

        vm.prank(outsider);
        vm.expectRevert(
            abi.encodeWithSelector(
                ConfidentialRWA.RecipientNotKycApproved.selector, outsider
            )
        );
        rwa.settlePurchase{value: 0.01 ether}(tokenId);
    }

    function test_Settle_RevertsWhenBuyingOwnToken() public {
        vm.startPrank(bank);
        uint256 tokenId = rwa.mintNotarization(DOC, SWARM);
        vm.deal(bank, 1 ether);
        vm.expectRevert(ConfidentialRWA.CannotBuyOwnToken.selector);
        rwa.settlePurchase{value: 0.01 ether}(tokenId);
        vm.stopPrank();
    }

    /// Se il venditore rifiuta i fondi, NULLA accade: né consegna né pagamento.
    function test_Settle_IsAtomicWhenSellerRejectsFunds() public {
        RejectingSeller seller = new RejectingSeller();
        bytes32 doc = keccak256("da-venditore-ostile.pdf");

        seller.mint(rwa, doc, SWARM);
        uint256 tokenId = uint256(doc);

        vm.prank(bank);
        rwa.setKycApproval(buyer, true);

        uint256 buyerBefore = buyer.balance;
        vm.prank(buyer);
        vm.expectRevert(ConfidentialRWA.SellerTransferFailed.selector);
        rwa.settlePurchase{value: 0.01 ether}(tokenId);

        assertEq(rwa.ownerOf(tokenId), address(seller), "il token non si muove");
        assertEq(buyer.balance, buyerBefore, "il compratore non paga");
    }
}
