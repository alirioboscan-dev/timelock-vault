// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

/// @title Timelock Vault
/// @notice Bóvedas de ahorro programado en ETH, sin rendimiento (1:1) y sin operador privilegiado.
///         - Individual: un titular deposita y retira todo cuando llega la fecha de desbloqueo.
///         - Compartida (2/2): quien la crea invita a otra persona, que debe aceptarla; recién
///           entonces los dos aportan por separado y, al vencer, con las dos aprobaciones, cada
///           uno retira exactamente lo que aportó. La fecha queda fija desde la creación.
/// @dev Los retiros siguen Checks-Effects-Interactions: el saldo se pone en cero antes de transferir
///      con `call`, y si la transferencia falla se revierte todo.
///      Riesgo asumido (whitepaper, sección 5): en una bóveda compartida, si un titular pierde su clave
///      o no aprueba, los fondos quedan bloqueados. No hay claves maestras ni pausas.
contract TimelockVault {
    // ---------------------------------------------------------------------
    // Datos
    // ---------------------------------------------------------------------

    /// @notice Largo máximo del nombre de una bóveda, en bytes, para acotar el gas.
    uint256 public constant MAX_NAME_LENGTH = 64;

    struct Vault {
        address owner;
        uint64 unlockTime;
        bool withdrawn;
        uint256 balance;
        string name;
    }

    struct SharedVault {
        address[2] participants;
        uint64 unlockTime;
        bool accepted;
        string name;
        uint256[2] contributions;
        bool[2] approved;
        bool[2] withdrawn;
    }

    /// @dev Los identificadores empiezan en 1, para que 0 signifique "no existe".
    uint256 public vaultCount;
    uint256 public sharedVaultCount;

    mapping(uint256 vaultId => Vault) private _vaults;
    mapping(address owner => uint256[] vaultIds) private _vaultsOf;

    mapping(uint256 sharedVaultId => SharedVault) private _sharedVaults;
    mapping(address participant => uint256[] sharedVaultIds) private _sharedVaultsOf;

    // ---------------------------------------------------------------------
    // Eventos
    // ---------------------------------------------------------------------

    event VaultCreated(uint256 indexed vaultId, address indexed owner, string name, uint64 unlockTime);
    event Deposited(uint256 indexed vaultId, address indexed from, uint256 amount, uint256 newBalance);
    event UnlockTimeExtended(uint256 indexed vaultId, uint64 previousUnlockTime, uint64 newUnlockTime);
    event Withdrawn(uint256 indexed vaultId, address indexed to, uint256 amount);

    event SharedVaultCreated(
        uint256 indexed sharedVaultId,
        address indexed creator,
        address indexed partner,
        string name,
        uint64 unlockTime
    );
    event SharedVaultAccepted(uint256 indexed sharedVaultId, address indexed partner);
    event SharedDeposited(uint256 indexed sharedVaultId, address indexed from, uint256 amount, uint256 newContribution);
    event WithdrawalApproved(uint256 indexed sharedVaultId, address indexed participant);
    event SharedWithdrawn(uint256 indexed sharedVaultId, address indexed to, uint256 amount);

    // ---------------------------------------------------------------------
    // Errores
    // ---------------------------------------------------------------------

    error ZeroDeposit();
    error InvalidName();
    error UnlockTimeNotInFuture(uint64 unlockTime);
    error UnlockTimeNotLater(uint64 currentUnlockTime, uint64 newUnlockTime);
    error VaultNotFound(uint256 vaultId);
    error NotOwner(uint256 vaultId, address caller);
    error NotParticipant(uint256 sharedVaultId, address caller);
    error NotInvited(uint256 sharedVaultId, address caller);
    error AlreadyAccepted();
    error NotAccepted();
    error InvalidPartner(address partner);
    error StillLocked(uint64 unlockTime);
    error AlreadyWithdrawn();
    error AlreadyApproved();
    error MissingApprovals();
    error NothingToWithdraw();
    error TransferFailed();

    // ---------------------------------------------------------------------
    // Bóveda individual
    // ---------------------------------------------------------------------

    /// @notice Crea una bóveda individual con un primer depósito.
    /// @param name Nombre visible (por ejemplo, "Viaje a Japón"), de 1 a 64 bytes.
    /// @param unlockTime Fecha de desbloqueo (timestamp UNIX en segundos), en el futuro.
    /// @return vaultId Identificador de la bóveda.
    function createVault(string calldata name, uint64 unlockTime) external payable returns (uint256 vaultId) {
        if (msg.value == 0) revert ZeroDeposit();
        _checkName(name);
        _checkFuture(unlockTime);

        vaultId = ++vaultCount;
        Vault storage v = _vaults[vaultId];
        v.owner = msg.sender;
        v.unlockTime = unlockTime;
        v.balance = msg.value;
        v.name = name;
        _vaultsOf[msg.sender].push(vaultId);

        emit VaultCreated(vaultId, msg.sender, name, unlockTime);
        emit Deposited(vaultId, msg.sender, msg.value, msg.value);
    }

    /// @notice El titular suma ETH a su bóveda. No cambia la fecha de desbloqueo.
    function deposit(uint256 vaultId) external payable {
        if (msg.value == 0) revert ZeroDeposit();
        Vault storage v = _ownedVault(vaultId);
        if (v.withdrawn) revert AlreadyWithdrawn();

        v.balance += msg.value;
        emit Deposited(vaultId, msg.sender, msg.value, v.balance);
    }

    /// @notice El titular posterga la fecha de desbloqueo. Nunca se puede adelantar.
    function extendUnlockTime(uint256 vaultId, uint64 newUnlockTime) external {
        Vault storage v = _ownedVault(vaultId);
        if (v.withdrawn) revert AlreadyWithdrawn();
        if (newUnlockTime <= v.unlockTime) revert UnlockTimeNotLater(v.unlockTime, newUnlockTime);

        uint64 previous = v.unlockTime;
        v.unlockTime = newUnlockTime;
        emit UnlockTimeExtended(vaultId, previous, newUnlockTime);
    }

    /// @notice El titular retira todo el saldo, si ya llegó la fecha de desbloqueo.
    function withdraw(uint256 vaultId) external {
        // Checks
        Vault storage v = _ownedVault(vaultId);
        if (v.withdrawn) revert AlreadyWithdrawn();
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < v.unlockTime) revert StillLocked(v.unlockTime);

        // Effects
        uint256 amount = v.balance;
        v.balance = 0;
        v.withdrawn = true;

        emit Withdrawn(vaultId, msg.sender, amount);

        // Interactions
        _send(msg.sender, amount);
    }

    // ---------------------------------------------------------------------
    // Bóveda compartida (2/2)
    // ---------------------------------------------------------------------

    /// @notice Crea una bóveda compartida pendiente e invita a otra persona. No admite ETH: los
    ///         aportes empiezan cuando el invitado la acepta. Solo se agrega a la lista de quien la crea.
    /// @param partner Dirección del segundo titular (el invitado).
    /// @param unlockTime Fecha de desbloqueo, en el futuro. No se puede cambiar después.
    /// @return sharedVaultId Identificador de la bóveda compartida.
    function createSharedVault(string calldata name, address partner, uint64 unlockTime)
        external
        returns (uint256 sharedVaultId)
    {
        if (partner == address(0) || partner == msg.sender || partner == address(this)) {
            revert InvalidPartner(partner);
        }
        _checkName(name);
        _checkFuture(unlockTime);

        sharedVaultId = ++sharedVaultCount;
        SharedVault storage s = _sharedVaults[sharedVaultId];
        s.participants = [msg.sender, partner];
        s.unlockTime = unlockTime;
        s.name = name;
        _sharedVaultsOf[msg.sender].push(sharedVaultId);

        emit SharedVaultCreated(sharedVaultId, msg.sender, partner, name, unlockTime);
    }

    /// @notice El invitado acepta la bóveda compartida. Recién entonces aparece en su lista y
    ///         los dos pueden aportar y aprobar. Se acepta una sola vez.
    function acceptSharedVault(uint256 sharedVaultId) external {
        SharedVault storage s = _existingSharedVault(sharedVaultId);
        if (msg.sender != s.participants[1]) revert NotInvited(sharedVaultId, msg.sender);
        if (s.accepted) revert AlreadyAccepted();

        s.accepted = true;
        _sharedVaultsOf[msg.sender].push(sharedVaultId);
        emit SharedVaultAccepted(sharedVaultId, msg.sender);
    }

    /// @notice Un titular suma su aporte. Cada aporte se registra por separado.
    function depositShared(uint256 sharedVaultId) external payable {
        if (msg.value == 0) revert ZeroDeposit();
        (SharedVault storage s, uint256 i) = _participantVault(sharedVaultId);
        if (!s.accepted) revert NotAccepted();
        if (s.withdrawn[i]) revert AlreadyWithdrawn();

        s.contributions[i] += msg.value;
        emit SharedDeposited(sharedVaultId, msg.sender, msg.value, s.contributions[i]);
    }

    /// @notice Un titular aprueba el retiro. Se puede aprobar antes o después de la fecha;
    ///         el retiro igual exige que la fecha haya llegado. La aprobación no se revoca.
    function approveWithdrawal(uint256 sharedVaultId) external {
        (SharedVault storage s, uint256 i) = _participantVault(sharedVaultId);
        if (!s.accepted) revert NotAccepted();
        if (s.approved[i]) revert AlreadyApproved();

        s.approved[i] = true;
        emit WithdrawalApproved(sharedVaultId, msg.sender);
    }

    /// @notice Un titular retira lo que aportó, si llegó la fecha y aprobaron los dos.
    function withdrawShared(uint256 sharedVaultId) external {
        // Checks
        (SharedVault storage s, uint256 i) = _participantVault(sharedVaultId);
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < s.unlockTime) revert StillLocked(s.unlockTime);
        if (!(s.approved[0] && s.approved[1])) revert MissingApprovals();
        if (s.withdrawn[i]) revert AlreadyWithdrawn();
        uint256 amount = s.contributions[i];
        if (amount == 0) revert NothingToWithdraw();

        // Effects
        s.contributions[i] = 0;
        s.withdrawn[i] = true;

        emit SharedWithdrawn(sharedVaultId, msg.sender, amount);

        // Interactions
        _send(msg.sender, amount);
    }

    // ---------------------------------------------------------------------
    // Consultas (sin gas desde la web)
    // ---------------------------------------------------------------------

    function getVaultDetails(uint256 vaultId) external view returns (Vault memory) {
        return _existingVault(vaultId);
    }

    function getVaultsOf(address owner) external view returns (uint256[] memory) {
        return _vaultsOf[owner];
    }

    function getSharedVaultDetails(uint256 sharedVaultId) external view returns (SharedVault memory) {
        return _existingSharedVault(sharedVaultId);
    }

    function getSharedVaultsOf(address participant) external view returns (uint256[] memory) {
        return _sharedVaultsOf[participant];
    }

    // ---------------------------------------------------------------------
    // Internos
    // ---------------------------------------------------------------------

    function _existingVault(uint256 vaultId) internal view returns (Vault storage v) {
        v = _vaults[vaultId];
        if (v.owner == address(0)) revert VaultNotFound(vaultId);
    }

    function _ownedVault(uint256 vaultId) internal view returns (Vault storage v) {
        v = _existingVault(vaultId);
        if (v.owner != msg.sender) revert NotOwner(vaultId, msg.sender);
    }

    function _existingSharedVault(uint256 sharedVaultId) internal view returns (SharedVault storage s) {
        s = _sharedVaults[sharedVaultId];
        if (s.participants[0] == address(0)) revert VaultNotFound(sharedVaultId);
    }

    /// @return s La bóveda compartida.
    /// @return i Posición del remitente entre los titulares (0 = quien la creó, 1 = el otro).
    function _participantVault(uint256 sharedVaultId) internal view returns (SharedVault storage s, uint256 i) {
        s = _existingSharedVault(sharedVaultId);
        if (msg.sender == s.participants[0]) return (s, 0);
        if (msg.sender == s.participants[1]) return (s, 1);
        revert NotParticipant(sharedVaultId, msg.sender);
    }

    function _checkName(string calldata name) internal pure {
        uint256 length = bytes(name).length;
        if (length == 0 || length > MAX_NAME_LENGTH) revert InvalidName();
    }

    function _checkFuture(uint64 unlockTime) internal view {
        // forge-lint: disable-next-line(block-timestamp)
        if (unlockTime <= block.timestamp) revert UnlockTimeNotInFuture(unlockTime);
    }

    function _send(address to, uint256 amount) internal {
        (bool ok,) = payable(to).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
