// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {ERC721} from "openzeppelin-contracts/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";

/**
 * @title ConfidentialRWA
 * @notice Notarizzazione di documenti come asset tokenizzato su Avalanche Fuji.
 *
 * Il documento non è qui. Sta cifrato su Swarm, e la chiave di decifratura non
 * lascia mai il browser dell'utente. On-chain finiscono solo due impegni di 32
 * byte: l'hash SHA-256 del documento e l'INDIRIZZO pubblico Swarm.
 *
 * Tre regole, nell'ordine richiesto dal Track B di Team1:
 *
 *  1. ASSET RULE      tokenId == uint256(documentHash). Un documento, un token,
 *                     per sempre. Il secondo mint dello stesso hash rientra e
 *                     basta: l'unicità è una proprietà del tipo, non un check
 *                     che qualcuno può dimenticare di scrivere.
 *  2. TRANSFER POLICY il trasferimento richiede che il DESTINATARIO sia
 *                     approvato KYC. Applicata in _update, quindi vale per
 *                     transferFrom, safeTransferFrom e per il settlement,
 *                     senza scorciatoie.
 *  3. SETTLEMENT      settlePurchase() è un Delivery-versus-Payment atomico:
 *                     o il compratore riceve il token e il venditore i fondi,
 *                     o non accade nulla.
 */
contract ConfidentialRWA is ERC721, Ownable, ReentrancyGuard {
    /// @notice Prezzo fisso di settlement. Testnet: nessun valore reale.
    uint256 public constant SETTLEMENT_PRICE = 0.01 ether;

    /// @notice Indirizzo pubblico Swarm del documento cifrato, per tokenId.
    /// @dev 32 byte. NON è la reference completa: quella è di 64 byte e la
    ///      seconda metà è la chiave di decifratura, che non deve mai toccare
    ///      un registro pubblico.
    mapping(uint256 tokenId => bytes32 swarmAddress) public swarmAddressOf;

    /// @notice Blocco in cui il token è stato emesso, come prova di esistenza.
    mapping(uint256 tokenId => uint256 blockNumber) public notarizedAtBlock;

    /// @notice Whitelist di eleggibilità. Solo l'owner la modifica.
    mapping(address account => bool approved) public kycApproved;

    event NotarizationMinted(
        uint256 indexed tokenId,
        bytes32 indexed documentHash,
        bytes32 swarmAddress,
        address indexed to
    );
    event KycApprovalSet(address indexed account, bool approved);
    event PurchaseSettled(
        uint256 indexed tokenId,
        address indexed seller,
        address indexed buyer,
        uint256 price
    );

    error ZeroDocumentHash();
    error ZeroSwarmAddress();
    error RecipientNotKycApproved(address recipient);
    error IncorrectSettlementValue(uint256 sent, uint256 required);
    error CannotBuyOwnToken();
    error SellerTransferFailed();

    constructor(address initialOwner)
        ERC721("Ancorhash Confidential RWA", "ACRWA")
        Ownable(initialOwner)
    {
        // Chi emette è eleggibile per costruzione: senza questo il primo
        // settlement verso il relayer sarebbe impossibile.
        kycApproved[initialOwner] = true;
        emit KycApprovalSet(initialOwner, true);
    }

    // ---------------------------------------------------------------- ASSET

    /**
     * @notice Emette il token di notarizzazione per un documento.
     * @param documentHash SHA-256 del documento in chiaro, calcolato nel browser.
     * @param swarmAddress Indirizzo pubblico Swarm del blob cifrato (32 byte).
     * @return tokenId Sempre uint256(documentHash).
     *
     * @dev Rientra con ERC721InvalidSender se il documento è già notarizzato:
     *      è la regola d'asset che fa il suo lavoro, non un difetto. Il backend
     *      la traduce in 409 Conflict.
     */
    function mintNotarization(bytes32 documentHash, bytes32 swarmAddress)
        external
        returns (uint256 tokenId)
    {
        if (documentHash == bytes32(0)) revert ZeroDocumentHash();
        if (swarmAddress == bytes32(0)) revert ZeroSwarmAddress();

        tokenId = uint256(documentHash);

        // _mint rientra se il token esiste già: unicità garantita dal tipo.
        _mint(msg.sender, tokenId);

        swarmAddressOf[tokenId] = swarmAddress;
        notarizedAtBlock[tokenId] = block.number;

        emit NotarizationMinted(tokenId, documentHash, swarmAddress, msg.sender);
    }

    /// @notice True se il documento è già stato notarizzato.
    function isNotarized(bytes32 documentHash) external view returns (bool) {
        return _ownerOf(uint256(documentHash)) != address(0);
    }

    // --------------------------------------------------------------- POLICY

    /// @notice Abilita o revoca l'eleggibilità di un conto. Solo owner.
    function setKycApproval(address account, bool approved) external onlyOwner {
        kycApproved[account] = approved;
        emit KycApprovalSet(account, approved);
    }

    /**
     * @dev Punto unico di applicazione della policy di trasferimento.
     *      In OZ v5 ogni movimento passa da qui, quindi non esiste un percorso
     *      che la aggiri.
     *
     *      Mint (from == 0) e burn (to == 0) restano liberi: il primo perché
     *      l'emittente è l'istituzione che notarizza, il secondo perché
     *      impedire di distruggere un token bloccherebbe anche la cancellazione
     *      legittima di un record.
     */
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address)
    {
        address from = _ownerOf(tokenId);

        bool isMint = from == address(0);
        bool isBurn = to == address(0);

        if (!isMint && !isBurn && !kycApproved[to]) {
            revert RecipientNotKycApproved(to);
        }

        return super._update(to, tokenId, auth);
    }

    // ----------------------------------------------------------- SETTLEMENT

    /**
     * @notice Compra un token notarizzato pagando il prezzo fisso: consegna
     *         contro pagamento, atomica.
     *
     * @dev Ordine checks-effects-interactions. Il token si muove PRIMA che i
     *      fondi partano, così il trasferimento di valore — l'unica chiamata
     *      esterna — è l'ultima cosa che accade. In più nonReentrant, perché
     *      il venditore può essere un contratto.
     *
     *      L'eleggibilità del compratore è verificata qui in modo esplicito e
     *      di nuovo dentro _update: ridondante di proposito, così il messaggio
     *      d'errore resta parlante e la policy vale comunque.
     */
    function settlePurchase(uint256 tokenId) external payable nonReentrant {
        if (msg.value != SETTLEMENT_PRICE) {
            revert IncorrectSettlementValue(msg.value, SETTLEMENT_PRICE);
        }
        if (!kycApproved[msg.sender]) revert RecipientNotKycApproved(msg.sender);

        address seller = ownerOf(tokenId);
        if (seller == msg.sender) revert CannotBuyOwnToken();

        // Effetto: la consegna. _update applica di nuovo la policy.
        _transfer(seller, msg.sender, tokenId);

        // Interazione: il pagamento, per ultimo.
        (bool sent, ) = payable(seller).call{value: msg.value}("");
        if (!sent) revert SellerTransferFailed();

        emit PurchaseSettled(tokenId, seller, msg.sender, msg.value);
    }
}
