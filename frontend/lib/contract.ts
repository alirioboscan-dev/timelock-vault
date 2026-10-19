// Configuración del contrato TimelockVault v2 desplegado en Sepolia.
// Fuente: contracts/ignition/deployments/timelock-v2 en este mismo repositorio.
// La dirección y el bloque se pueden reemplazar con variables de entorno públicas
// (NEXT_PUBLIC_*), por ejemplo para apuntar a una red local de pruebas.

export const SEPOLIA_CHAIN_ID = BigInt(11155111)
export const SEPOLIA_CHAIN_ID_HEX = '0xaa36a7'

export const CONTRACT_ADDRESS =
  process.env.NEXT_PUBLIC_TIMELOCK_ADDRESS ?? '0xF5bbf82c0c79a052b3Fc0B5c79387d3DfeAd4b5F'

/** Bloque del despliegue de la v2: desde acá se buscan las invitaciones en los eventos. */
export const DEPLOY_BLOCK = Number(process.env.NEXT_PUBLIC_TIMELOCK_DEPLOY_BLOCK ?? 11930872)

export const ETHERSCAN_URL = 'https://sepolia.etherscan.io'

/** Largo máximo del nombre, en bytes UTF-8 (MAX_NAME_LENGTH del contrato). */
export const MAX_NAME_BYTES = 64

// ABI en formato legible: solo lo que usa la app.
export const TIMELOCK_ABI = [
  // Bóveda individual
  'function createVault(string name, uint64 unlockTime) payable returns (uint256)',
  'function deposit(uint256 vaultId) payable',
  'function extendUnlockTime(uint256 vaultId, uint64 newUnlockTime)',
  'function withdraw(uint256 vaultId)',
  'function getVaultsOf(address owner) view returns (uint256[])',
  'function getVaultDetails(uint256 vaultId) view returns (tuple(address owner, uint64 unlockTime, bool withdrawn, uint256 balance, string name))',
  // Bóveda compartida (2/2)
  'function createSharedVault(string name, address partner, uint64 unlockTime) returns (uint256)',
  'function acceptSharedVault(uint256 sharedVaultId)',
  'function depositShared(uint256 sharedVaultId) payable',
  'function approveWithdrawal(uint256 sharedVaultId)',
  'function withdrawShared(uint256 sharedVaultId)',
  'function getSharedVaultsOf(address participant) view returns (uint256[])',
  'function getSharedVaultDetails(uint256 sharedVaultId) view returns (tuple(address[2] participants, uint64 unlockTime, bool accepted, string name, uint256[2] contributions, bool[2] approved, bool[2] withdrawn))',
  // Eventos
  'event VaultCreated(uint256 indexed vaultId, address indexed owner, string name, uint64 unlockTime)',
  'event SharedVaultCreated(uint256 indexed sharedVaultId, address indexed creator, address indexed partner, string name, uint64 unlockTime)',
  'event SharedVaultAccepted(uint256 indexed sharedVaultId, address indexed partner)',
  // Errores
  'error ZeroDeposit()',
  'error InvalidName()',
  'error UnlockTimeNotInFuture(uint64 unlockTime)',
  'error UnlockTimeNotLater(uint64 currentUnlockTime, uint64 newUnlockTime)',
  'error VaultNotFound(uint256 vaultId)',
  'error NotOwner(uint256 vaultId, address caller)',
  'error NotParticipant(uint256 sharedVaultId, address caller)',
  'error NotInvited(uint256 sharedVaultId, address caller)',
  'error InvalidPartner(address partner)',
  'error StillLocked(uint64 unlockTime)',
  'error AlreadyWithdrawn()',
  'error AlreadyApproved()',
  'error AlreadyAccepted()',
  'error NotAccepted()',
  'error MissingApprovals()',
  'error NothingToWithdraw()',
  'error TransferFailed()',
] as const

/** Mensajes para el usuario de cada error del contrato (ver el documento técnico). */
export const ERROR_MESSAGES: Record<string, string> = {
  ZeroDeposit: 'Ingresá un monto mayor que cero.',
  InvalidName: 'El nombre debe tener entre 1 y 64 bytes.',
  UnlockTimeNotInFuture: 'Elegí una fecha de desbloqueo futura.',
  UnlockTimeNotLater: 'La nueva fecha tiene que ser posterior a la actual.',
  VaultNotFound: 'No existe esa bóveda.',
  NotOwner: 'Tu cuenta no es titular de esta bóveda.',
  NotParticipant: 'Tu cuenta no es titular de esta bóveda.',
  NotInvited: 'Solo la persona invitada puede aceptar esta bóveda.',
  InvalidPartner: 'Ingresá la dirección de otra persona.',
  StillLocked: 'Los fondos siguen bloqueados hasta la fecha de desbloqueo.',
  AlreadyWithdrawn: 'Esta bóveda ya fue retirada.',
  AlreadyApproved: 'Ya aprobaste este retiro.',
  AlreadyAccepted: 'Esta bóveda ya fue aceptada.',
  NotAccepted: 'La bóveda todavía no fue aceptada por el otro titular.',
  MissingApprovals: 'Falta la aprobación del otro titular.',
  NothingToWithdraw: 'No aportaste fondos a esta bóveda.',
  TransferFailed: 'No se pudo enviar el ETH; no se movió nada.',
}
