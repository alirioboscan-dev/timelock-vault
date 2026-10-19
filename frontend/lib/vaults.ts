export type VaultKind = 'individual' | 'shared'
export type VaultStatus = 'locked' | 'available' | 'released'

export type Contribution = {
  address: string
  amount: number
  withdrawn: boolean
}

export type Vault = {
  id: string
  kind: VaultKind
  name: string
  createdAt: string
  unlockAt: string
  contributions: Contribution[]
  approvals: string[]
}

export const DEMO_WALLET = '0x7A42...91cE'
export const DEMO_PARTNER = '0x3B19...F02a'

export function createInitialVaults(): Vault[] {
  const now = Date.now()
  return [
    {
      id: 'emergency-fund',
      kind: 'individual',
      name: 'Fondo de emergencia',
      createdAt: new Date(now - 1000 * 60 * 60 * 24 * 28).toISOString(),
      unlockAt: new Date(now + 1000 * 60 * 60 * 24 * 58).toISOString(),
      contributions: [{ address: DEMO_WALLET, amount: 1.25, withdrawn: false }],
      approvals: [],
    },
    {
      id: 'japan-trip',
      kind: 'individual',
      name: 'Viaje a Japón',
      createdAt: new Date(now - 1000 * 60 * 60 * 24 * 12).toISOString(),
      unlockAt: new Date(now + 1000 * 60 * 60 * 24 * 18).toISOString(),
      contributions: [{ address: DEMO_WALLET, amount: 0.8, withdrawn: false }],
      approvals: [],
    },
    {
      id: 'shared-home',
      kind: 'shared',
      name: 'Ahorro para la casa',
      createdAt: new Date(now - 1000 * 60 * 60 * 24 * 35).toISOString(),
      unlockAt: new Date(now + 1000 * 60 * 60 * 24 * 8).toISOString(),
      contributions: [
        { address: DEMO_WALLET, amount: 1.4, withdrawn: false },
        { address: DEMO_PARTNER, amount: 0.9, withdrawn: false },
      ],
      approvals: [],
    },
  ]
}

export function getVaultStatus(vault: Vault): VaultStatus {
  if (vault.contributions.every((entry) => entry.withdrawn)) return 'released'
  if (new Date(vault.unlockAt).getTime() <= Date.now() && (vault.kind === 'individual' || vault.approvals.length === 2)) return 'available'
  return 'locked'
}

export function formatEth(amount: number) {
  return `${amount.toLocaleString('es-AR', { maximumFractionDigits: 4 })} ETH`
}

export function shortAddress(address: string) {
  return address.length > 14 ? `${address.slice(0, 6)}...${address.slice(-4)}` : address
}

export function totalVaultAmount(vaults: Vault[]) {
  return vaults.reduce((sum, vault) => sum + vault.contributions.reduce((vaultSum, contribution) => vaultSum + (contribution.withdrawn ? 0 : contribution.amount), 0), 0)
}
