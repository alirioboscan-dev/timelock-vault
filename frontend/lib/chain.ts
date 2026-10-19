// Capa de acceso al contrato TimelockVault: lecturas, transacciones y errores.
// No depende de React ni del navegador, así se puede probar contra una red local.
import { Contract, formatEther, getAddress, isAddress, type ContractRunner } from 'ethers'
import { CONTRACT_ADDRESS, DEPLOY_BLOCK, ERROR_MESSAGES, MAX_NAME_BYTES, TIMELOCK_ABI } from './contract'
import type { Vault } from './vaults'

export function getTimelock(runner: ContractRunner, address: string = CONTRACT_ADDRESS) {
  return new Contract(address, TIMELOCK_ABI, runner)
}

const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** El nombre se mide en bytes UTF-8, como en el contrato: 33 "ó" ya no entran. */
export function nameByteLength(name: string) {
  return new TextEncoder().encode(name).length
}

export function validateName(name: string): string | null {
  const bytes = nameByteLength(name.trim())
  if (bytes === 0) return 'Ingresá un nombre para la bóveda.'
  if (bytes > MAX_NAME_BYTES) return `El nombre ocupa ${bytes} bytes y el máximo es ${MAX_NAME_BYTES}. Acortalo o usá menos tildes y emojis.`
  return null
}

export function validatePartner(partner: string, self: string): string | null {
  if (!isAddress(partner)) return 'Ingresá una dirección de Ethereum válida (0x seguido de 40 caracteres).'
  if (sameAddress(partner, self)) return 'El segundo titular tiene que ser otra persona.'
  if (sameAddress(partner, CONTRACT_ADDRESS)) return 'No podés invitar a la dirección del contrato.'
  return null
}

/** Lee un campo que puede fallar al decodificar (por ejemplo, un nombre con bytes que no son UTF-8). */
function safe<T>(read: () => T, fallback: T): T {
  try {
    return read()
  } catch {
    return fallback
  }
}

const toIso = (seconds: bigint) => new Date(Number(seconds) * 1000).toISOString()
const eth = (wei: bigint) => Number(formatEther(wei))

async function readIndividual(timelock: Contract, id: bigint): Promise<Vault> {
  const v = await timelock.getVaultDetails(id)
  const balance: bigint = v.balance
  return {
    id: `i-${id}`,
    onchainId: id,
    kind: 'individual',
    name: safe(() => v.name as string, '(nombre ilegible)'),
    unlockAt: toIso(v.unlockTime),
    contributions: [{ address: v.owner, amount: eth(balance), amountWei: balance, withdrawn: v.withdrawn }],
    approvals: [],
  }
}

async function readShared(timelock: Contract, id: bigint): Promise<Vault> {
  const s = await timelock.getSharedVaultDetails(id)
  const participants: string[] = [s.participants[0], s.participants[1]]
  const contributions: bigint[] = [s.contributions[0], s.contributions[1]]
  return {
    id: `s-${id}`,
    onchainId: id,
    kind: 'shared',
    name: safe(() => s.name as string, '(nombre ilegible)'),
    unlockAt: toIso(s.unlockTime),
    accepted: s.accepted,
    contributions: participants.map((address, i) => ({
      address,
      amount: eth(contributions[i]),
      amountWei: contributions[i],
      withdrawn: s.withdrawn[i],
    })),
    approvals: participants.filter((_, i) => s.approved[i]),
  }
}

/**
 * Bóvedas de una cuenta: sus individuales, las compartidas que creó o aceptó,
 * y las invitaciones pendientes (que solo se ven en los eventos SharedVaultCreated).
 */
export async function loadVaults(timelock: Contract, user: string) {
  const [individualIds, sharedIds]: [bigint[], bigint[]] = await Promise.all([
    timelock.getVaultsOf(user),
    timelock.getSharedVaultsOf(user),
  ])
  const vaults = await Promise.all([
    ...individualIds.map((id) => readIndividual(timelock, id)),
    ...sharedIds.map((id) => readShared(timelock, id)),
  ])

  let invitations: Vault[] = []
  let invitationsError = false
  try {
    const events = await timelock.queryFilter(timelock.filters.SharedVaultCreated(null, null, user), DEPLOY_BLOCK)
    const known = new Set(sharedIds.map(String))
    const pendingIds = [...new Set(events.map((e) => ('args' in e ? (e.args[0] as bigint) : null)).filter((id): id is bigint => id !== null))]
      .filter((id) => !known.has(String(id)))
    // Se aíslan los errores por invitación: una invitación rota (spam) no tira abajo la lista.
    const read = await Promise.allSettled(pendingIds.map((id) => readShared(timelock, id)))
    invitations = read
      .filter((r): r is PromiseFulfilledResult<Vault> => r.status === 'fulfilled')
      .map((r) => ({ ...r.value, invitation: true }))
      .filter((v) => !v.accepted)
  } catch {
    invitationsError = true
  }

  return { vaults: [...vaults, ...invitations], invitationsError }
}

/** Traduce cualquier error de ethers, MetaMask o el contrato a un mensaje para el usuario. */
export function friendlyError(error: unknown, timelock?: Contract): string {
  const e = error as { code?: string | number; data?: string; info?: { error?: { code?: number; data?: string } }; revert?: { name?: string }; shortMessage?: string; message?: string }
  if (e?.code === 'ACTION_REJECTED' || e?.code === 4001 || e?.info?.error?.code === 4001) return 'Cancelaste la operación en la wallet.'
  if (e?.code === 'INSUFFICIENT_FUNDS') return 'No tenés ETH suficiente para el monto y el gas.'

  const name = e?.revert?.name ?? decodeRevertName(e?.data ?? e?.info?.error?.data, timelock)
  if (name && ERROR_MESSAGES[name]) return ERROR_MESSAGES[name]
  return e?.shortMessage ?? 'No se pudo completar la operación. Probá de nuevo.'
}

function decodeRevertName(data: string | undefined, timelock?: Contract): string | undefined {
  if (!data || !timelock) return undefined
  try {
    return timelock.interface.parseError(data)?.name
  } catch {
    return undefined
  }
}

export function checksum(address: string) {
  return getAddress(address)
}
