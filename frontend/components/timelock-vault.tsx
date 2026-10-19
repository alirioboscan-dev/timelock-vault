'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Gauge,
  History,
  Info,
  Landmark,
  LockKeyhole,
  Mail,
  Menu,
  Plus,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Users,
  WalletCards,
  X,
} from 'lucide-react'
import { getAddress, parseEther, type ContractTransactionResponse } from 'ethers'
import { createInitialVaults, DEMO_PARTNER, DEMO_WALLET, formatEth, getVaultStatus, shortAddress, totalVaultAmount, type Vault, type VaultKind } from '@/lib/vaults'
import { CONTRACT_ADDRESS, ETHERSCAN_URL } from '@/lib/contract'
import { friendlyError, getTimelock, loadVaults, validateName, validatePartner } from '@/lib/chain'
import { useWallet } from '@/lib/use-wallet'

const navItems = [
  { label: 'Resumen', icon: Gauge },
  { label: 'Mis bóvedas', icon: LockKeyhole },
  { label: 'Compartidas', icon: Users },
  { label: 'Actividad', icon: History },
  { label: 'Seguridad', icon: ShieldCheck },
  { label: 'Cómo funciona', icon: CircleHelp },
]

type Toast = { text: string; href?: string }
type FormState = { name: string; amount: string; partner: string; unlock: string }
type Timelock = ReturnType<typeof getTimelock>

function dateLabel(value: string) {
  return new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value))
}

function relativeTime(value: string) {
  const diff = new Date(value).getTime() - Date.now()
  const days = Math.ceil(Math.abs(diff) / 86400000)
  if (diff >= 0) return `en ${days} días`
  return `hace ${days} días`
}

function statusCopy(vault: Vault) {
  const status = getVaultStatus(vault)
  if (status === 'pending') return { label: vault.invitation ? 'Invitación pendiente' : 'Esperando aceptación', className: 'status-purple' }
  if (status === 'released') return { label: 'Retirada', className: 'status-muted' }
  if (status === 'available') return { label: vault.kind === 'shared' ? 'Liberación autorizada' : 'Disponible para retirar', className: 'status-green' }
  return { label: 'Bloqueada', className: 'status-gold' }
}

/** Convierte el valor de un input datetime-local a segundos UNIX. */
function toUnixSeconds(value: string) {
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? BigInt(Math.floor(ms / 1000)) : null
}

function parseAmount(value: string) {
  try {
    const wei = parseEther(value.trim().replace(',', '.'))
    return wei > BigInt(0) ? wei : null
  } catch {
    return null
  }
}

const sameAddress = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

export default function TimelockVault() {
  const wallet = useWallet()
  const [mode, setModeState] = useState<'demo' | 'chain'>('demo')
  // Se recuerda el modo elegido, así recargar la página no vuelve a la demo.
  const setMode = (next: 'demo' | 'chain') => {
    setModeState(next)
    try { window.localStorage.setItem('timelock-vault-mode', next) } catch {}
  }
  useEffect(() => {
    try { if (window.localStorage.getItem('timelock-vault-mode') === 'chain') setModeState('chain') } catch {}
  }, [])
  // Recalcula los estados (por ejemplo, "Bloqueada" → "Disponible") a medida que pasa el tiempo.
  const [, setTick] = useState(0)
  useEffect(() => { const timer = window.setInterval(() => setTick((t) => t + 1), 15000); return () => window.clearInterval(timer) }, [])
  const live = mode === 'chain' && !!wallet.account && wallet.onSepolia && !!wallet.signer

  const [demoVaults, setDemoVaults] = useState<Vault[]>(createInitialVaults)
  const [chainVaults, setChainVaults] = useState<Vault[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [activeNav, setActiveNav] = useState('Resumen')
  const [showCreate, setShowCreate] = useState(false)
  const [kind, setKind] = useState<VaultKind>('individual')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [demoIdentity, setDemoIdentity] = useState(DEMO_WALLET)
  const [toast, setToast] = useState<Toast | null>(null)
  const [form, setForm] = useState<FormState>({ name: '', amount: '', partner: DEMO_PARTNER, unlock: '' })

  const notify = (text: string, href?: string) => setToast({ text, href })

  // El modo demo se guarda en el navegador; los datos del contrato no (siempre se leen de la cadena).
  useEffect(() => {
    const stored = window.localStorage.getItem('timelock-vault-demo')
    if (stored) setDemoVaults(JSON.parse(stored))
  }, [])
  useEffect(() => { window.localStorage.setItem('timelock-vault-demo', JSON.stringify(demoVaults)) }, [demoVaults])
  useEffect(() => { if (toast) { const timer = window.setTimeout(() => setToast(null), toast.href ? 9000 : 6000); return () => window.clearTimeout(timer) } }, [toast])

  /** Lee las bóvedas del contrato. En modo silencioso (actualización periódica) no muestra carga ni avisos. */
  const reload = useCallback(async (silent = false) => {
    if (!live || !wallet.signer || !wallet.account) return
    if (!silent) setLoading(true)
    try {
      const { vaults, invitationsError } = await loadVaults(getTimelock(wallet.signer), wallet.account)
      setChainVaults(vaults)
      if (invitationsError && !silent) setToast({ text: 'No se pudieron leer las invitaciones pendientes. El resto de tus bóvedas está actualizado.' })
    } catch (error) {
      if (!silent) setToast({ text: friendlyError(error) })
    } finally {
      if (!silent) setLoading(false)
    }
  }, [live, wallet.signer, wallet.account])

  useEffect(() => { if (live) reload() }, [live, reload])
  // Vuelve a leer el contrato cada 30 segundos, para ver lo que hace el otro titular (aceptar, aportar, aprobar).
  useEffect(() => {
    if (!live) return
    const timer = window.setInterval(() => { if (!document.hidden) reload(true) }, 30000)
    return () => window.clearInterval(timer)
  }, [live, reload])

  const vaults = live ? chainVaults : demoVaults
  const individual = vaults.filter((vault) => vault.kind === 'individual')
  const shared = vaults.filter((vault) => vault.kind === 'shared')
  const invitations = shared.filter((vault) => vault.invitation)
  const total = totalVaultAmount(vaults)
  const nextUnlock = [...vaults].filter((vault) => getVaultStatus(vault) === 'locked').sort((a, b) => +new Date(a.unlockAt) - +new Date(b.unlockAt))[0]
  const activeCount = vaults.filter((v) => !v.invitation && getVaultStatus(v) !== 'released').length
  const detail = detailId ? vaults.find((vault) => vault.id === detailId) ?? null : null

  async function handleConnect() {
    try {
      if (!wallet.available) return notify('No se encontró MetaMask en este navegador. Instalala para usar la app con Sepolia.')
      if (!wallet.account) await wallet.connect()
      else if (!wallet.onSepolia) await wallet.switchToSepolia()
      setMode('chain')
    } catch (error) {
      notify(friendlyError(error))
    }
  }

  /** Envía una transacción, espera la confirmación y vuelve a leer el contrato. */
  async function runTx(label: string, send: (timelock: Timelock) => Promise<ContractTransactionResponse>) {
    if (!wallet.signer) return
    const timelock = getTimelock(wallet.signer)
    setBusy('Confirmá la operación en MetaMask…')
    let txUrl: string | undefined
    try {
      const tx = await send(timelock)
      txUrl = `${ETHERSCAN_URL}/tx/${tx.hash}`
      setBusy('Transacción enviada. Esperando confirmación en Sepolia (suele tardar unos 15 segundos)…')
      notify('Transacción enviada. Esperando confirmación en Sepolia…', txUrl)
      await tx.wait()
      notify(`${label}. Transacción confirmada.`, txUrl)
      await reload()
      return true
    } catch (error) {
      // Si la transacción llegó a enviarse y falló en la red, se muestra el link para revisarla.
      // Un caso visto en las pruebas: la Cuenta inteligente de MetaMask (EIP-7702) hace pasar la operación por su propio contrato.
      notify(txUrl
        ? 'La transacción se envió pero falló en la red y no cambió nada. Si tenés activada la Cuenta inteligente de MetaMask, desactivala y probá de nuevo.'
        : friendlyError(error, timelock), txUrl)
      await reload(true)
      return false
    } finally {
      setBusy(null)
    }
  }

  function openCreate(selected: VaultKind = 'individual') {
    setKind(selected)
    if (live && form.partner === DEMO_PARTNER) setForm({ ...form, partner: '' })
    setShowCreate(true)
  }

  async function createVault(event: React.FormEvent) {
    event.preventDefault()
    const name = form.name.trim()
    const nameError = validateName(name)
    if (nameError) return notify(nameError)
    const unlock = toUnixSeconds(form.unlock)
    if (!unlock || Number(unlock) * 1000 <= Date.now()) return notify('Elegí una fecha de desbloqueo futura.')
    const needsAmount = !(live && kind === 'shared')
    const amountWei = needsAmount ? parseAmount(form.amount) : null
    if (needsAmount && !amountWei) return notify('Ingresá un monto en ETH mayor que cero (máximo 18 decimales).')

    if (live) {
      if (kind === 'shared') {
        const partnerError = validatePartner(form.partner.trim(), wallet.account!)
        if (partnerError) return notify(partnerError)
      }
      const ok = await runTx(kind === 'shared' ? 'Invitación creada' : 'Bóveda creada', (c) =>
        kind === 'shared' ? c.createSharedVault(name, getAddress(form.partner.trim()), unlock) : c.createVault(name, unlock, { value: amountWei! }),
      )
      if (ok) { setShowCreate(false); setForm({ name: '', amount: '', partner: '', unlock: '' }) }
      return
    }

    // Modo demo: solo en el navegador.
    if (kind === 'shared' && (!/^0x[a-fA-F0-9]{8,40}$/.test(form.partner) || form.partner === DEMO_WALLET)) return notify('Revisá la wallet del segundo participante.')
    const amount = Number(form.amount.replace(',', '.'))
    const newVault: Vault = { id: crypto.randomUUID(), kind, name, createdAt: new Date().toISOString(), unlockAt: new Date(Number(unlock) * 1000).toISOString(), contributions: kind === 'shared' ? [{ address: DEMO_WALLET, amount, withdrawn: false }, { address: form.partner, amount: 0, withdrawn: false }] : [{ address: DEMO_WALLET, amount, withdrawn: false }], approvals: [] }
    setDemoVaults((current) => [newVault, ...current]); setShowCreate(false); setForm({ name: '', amount: '', partner: DEMO_PARTNER, unlock: '' }); notify('Bóveda creada en modo demo.')
  }

  // Acciones del modo demo (sin cambios de comportamiento respecto del prototipo).
  function demoApprove() {
    if (!detail || getVaultStatus(detail) !== 'locked' || new Date(detail.unlockAt).getTime() > Date.now()) { notify('La aprobación estará disponible cuando llegue la fecha.'); return }
    setDemoVaults((current) => current.map((vault) => vault.id === detail.id && !vault.approvals.includes(demoIdentity) ? { ...vault, approvals: [...vault.approvals, demoIdentity] } : vault)); notify('Aprobación registrada localmente.')
  }
  function demoWithdraw() {
    if (!detail || getVaultStatus(detail) !== 'available') { notify('Los fondos todavía no están disponibles para retirar.'); return }
    setDemoVaults((current) => current.map((vault) => vault.id === detail.id ? { ...vault, contributions: vault.contributions.map((entry) => entry.address === demoIdentity ? { ...entry, withdrawn: true } : entry) } : vault)); notify('Retiro simulado. No se movieron fondos reales.')
  }
  function resetDemo() { setDemoVaults(createInitialVaults()); notify('Datos de demostración restablecidos.') }

  // Acciones contra el contrato.
  const chainActions: ChainActions = {
    deposit: (vault, amount) => {
      const wei = parseAmount(amount)
      if (!wei) { notify('Ingresá un monto en ETH mayor que cero.'); return Promise.resolve(false) }
      return runTx('Depósito realizado', (c) => vault.kind === 'shared' ? c.depositShared(vault.onchainId!, { value: wei }) : c.deposit(vault.onchainId!, { value: wei }))
    },
    extend: (vault, value) => {
      const unlock = toUnixSeconds(value)
      if (!unlock || Number(unlock) * 1000 <= new Date(vault.unlockAt).getTime()) { notify('La nueva fecha tiene que ser posterior a la actual.'); return Promise.resolve(false) }
      return runTx('Fecha postergada', (c) => c.extendUnlockTime(vault.onchainId!, unlock))
    },
    accept: async (vault) => {
      const ok = await runTx('Invitación aceptada', (c) => c.acceptSharedVault(vault.onchainId!))
      if (ok) setDetailId(null) // Al aceptar se cierra el detalle; la bóveda ya aparece en Compartidas.
      return ok
    },
    approve: (vault) => runTx('Aprobación registrada', (c) => c.approveWithdrawal(vault.onchainId!)),
    withdraw: (vault) => runTx('Retiro realizado', (c) => vault.kind === 'shared' ? c.withdrawShared(vault.onchainId!) : c.withdraw(vault.onchainId!)),
  }

  const networkLabel = live ? 'Sepolia' : !wallet.account ? 'Red no conectada' : wallet.onSepolia ? 'Wallet lista en Sepolia' : 'Red incorrecta'
  const connectLabel = !wallet.account ? 'Conectar wallet' : !wallet.onSepolia ? 'Cambiar a Sepolia' : live ? shortAddress(wallet.account) : 'Usar Sepolia'

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><LockKeyhole /></div><span>Timelock <b>Vault</b></span></div>
        {live
          ? <div className="demo-pill live-pill"><span className="pulse-dot" /> SEPOLIA · EN VIVO <button onClick={() => setMode('demo')} aria-label="Pasar a modo demo" title="Pasar a modo demo"><RotateCcw /></button></div>
          : <div className="demo-pill"><span className="pulse-dot" /> MODO DEMO <button onClick={resetDemo} aria-label="Restablecer datos"><RotateCcw /></button></div>}
        <nav aria-label="Navegación principal" className="nav-list">
          {navItems.map(({ label, icon: Icon }) => <button key={label} className={`nav-item ${activeNav === label ? 'active' : ''}`} onClick={() => setActiveNav(label)}><Icon />{label}{label === 'Compartidas' && live && invitations.length > 0 && <span className="nav-badge">{invitations.length}</span>}</button>)}
        </nav>
        <div className="sidebar-bottom"><div className="help-card"><Sparkles /><div><strong>Diseñado para ahorrar</strong><span>Reglas claras, control total.</span></div></div><div className="wallet-mini"><div className="wallet-avatar"><WalletCards /></div><div><strong>{live ? shortAddress(wallet.account!) : shortAddress(DEMO_WALLET)}</strong><span>{live ? 'Tu wallet en Sepolia' : 'Wallet de demo'}</span></div><ChevronRight /></div></div>
      </aside>
      <main className="main-content">
        <header className="topbar"><button className="mobile-menu" aria-label="Abrir menú"><Menu /></button><div className="breadcrumb">Timelock Vault <ChevronRight /> <span>{activeNav}</span></div><div className="top-actions"><div className="network"><span className={`network-dot ${live ? 'live' : ''}`} /> {networkLabel}</div><button className="connect-button" onClick={live ? () => window.open(`${ETHERSCAN_URL}/address/${wallet.account}`, '_blank', 'noopener') : handleConnect} disabled={wallet.connecting}><WalletCards /> {wallet.connecting ? 'Conectando…' : connectLabel}</button></div></header>
        {live && invitations.length > 0 && <button className="invite-banner" onClick={() => setActiveNav('Compartidas')}><Mail /> Tenés {invitations.length === 1 ? 'una invitación pendiente' : `${invitations.length} invitaciones pendientes`} a bóvedas compartidas. <span>Revisar <ArrowUpRight /></span></button>}
        {activeNav === 'Resumen' ? <>
          <section className="hero"><div><div className="eyebrow"><span className="eyebrow-line" /> AHORRO PROGRAMADO EN ETH</div><h1>Ahorrá hoy.<br /><em>Desbloqueá</em> cuando llegue tu fecha.</h1><p>Creá una bóveda individual o ahorrá con otra persona. Reglas verificables para que retires solo cuando corresponde.</p><button className="primary-button" onClick={() => openCreate()}><Plus /> Crear bóveda <span className="button-arrow"><ArrowUpRight /></span></button></div><div className="hero-lock"><div className="orbital orbital-one" /><div className="orbital orbital-two" /><div className="lock-illustration"><LockKeyhole /></div><span className="orbit-label label-top">FECHA FIJA</span><span className="orbit-label label-bottom">CONTROL TOTAL</span></div></section>
          <section className="stats-grid"><div className="stat-card"><div className="stat-icon gold"><Landmark /></div><span>Total bloqueado</span><strong>{formatEth(total)}</strong><small><span className="positive">●</span> En tus bóvedas activas</small></div><div className="stat-card"><div className="stat-icon purple"><Clock3 /></div><span>Próximo desbloqueo</span><strong>{nextUnlock ? relativeTime(nextUnlock.unlockAt) : '—'}</strong><small>{nextUnlock ? nextUnlock.name : 'Sin bóvedas pendientes'}</small></div><div className="stat-card"><div className="stat-icon blue"><LockKeyhole /></div><span>Bóvedas activas</span><strong>{activeCount}</strong><small>Individuales y compartidas</small></div></section>
          <section className="section-heading"><div><h2>Tus bóvedas</h2><p>{live ? (loading ? 'Leyendo tus bóvedas en Sepolia…' : `Datos en vivo del contrato ${shortAddress(CONTRACT_ADDRESS)} en Sepolia.`) : 'Seguimiento de tus objetivos de ahorro.'}</p></div><button className="text-button" onClick={() => setActiveNav('Mis bóvedas')}>Ver todas <ArrowUpRight /></button></section>
          <div className="vault-columns"><VaultColumn title="Mis bóvedas individuales" icon={<LockKeyhole />} vaults={individual} onOpen={setDetailId} /><VaultColumn title="Mis bóvedas compartidas" icon={<Users />} vaults={shared} onOpen={setDetailId} /></div>
          <section className="how-section"><div className="section-heading"><div><h2>Cómo funciona</h2><p>Simple por diseño. Seguro por reglas.</p></div><button className="text-button" onClick={() => setActiveNav('Cómo funciona')}>Conocé más <ArrowUpRight /></button></div><div className="steps"><Step icon={<ArrowDownToLine />} number="01" title="Depositá" text="Elegí cuánto querés guardar en tu bóveda." /><Step icon={<LockKeyhole />} number="02" title="Bloqueá" text="Definí una fecha y dejá que el tiempo haga su parte." /><Step icon={<Check />} number="03" title="Liberá" text="Retirá cuando se cumpla la fecha y las reglas." /></div></section>
        </> : <ContentSection activeNav={activeNav} vaults={vaults} live={live} onOpen={setDetailId} onCreate={() => openCreate()} />}
      </main>
      {showCreate && <CreateModal kind={kind} setKind={setKind} form={form} setForm={setForm} live={live} busy={busy !== null} onClose={() => setShowCreate(false)} onSubmit={createVault} />}
      {detail && (live
        ? <ChainDetailModal vault={detail} account={wallet.account!} busy={busy} actions={chainActions} onClose={() => setDetailId(null)} />
        : <DetailModal vault={detail} identity={demoIdentity} setIdentity={setDemoIdentity} onClose={() => setDetailId(null)} onApprove={demoApprove} onWithdraw={demoWithdraw} />)}
      {toast && <div className="toast" role="status"><Info /> <span>{toast.text}{toast.href && <> <a href={toast.href} target="_blank" rel="noopener noreferrer">Ver en Etherscan</a></>}</span></div>}
    </div>
  )
}

type ChainActions = {
  deposit: (vault: Vault, amount: string) => Promise<boolean | undefined>
  extend: (vault: Vault, value: string) => Promise<boolean | undefined>
  accept: (vault: Vault) => Promise<boolean | undefined>
  approve: (vault: Vault) => Promise<boolean | undefined>
  withdraw: (vault: Vault) => Promise<boolean | undefined>
}

function VaultColumn({ title, icon, vaults, onOpen }: { title: string; icon: React.ReactNode; vaults: Vault[]; onOpen: (id: string) => void }) { return <div className="vault-group"><div className="group-title"><span>{icon}</span><h3>{title}</h3><b>{vaults.length}</b></div>{vaults.length === 0 && <p className="empty-note">Todavía no hay bóvedas acá.</p>}{vaults.map((vault) => <VaultCard key={vault.id} vault={vault} onOpen={onOpen} />)}</div> }
function VaultCard({ vault, onOpen }: { vault: Vault; onOpen: (id: string) => void }) {
  const copy = statusCopy(vault)
  const amount = vault.contributions.reduce((sum, c) => sum + (c.withdrawn ? 0 : c.amount), 0)
  const progress = vault.createdAt ? Math.max(4, Math.min(100, ((Date.now() - new Date(vault.createdAt).getTime()) / (new Date(vault.unlockAt).getTime() - new Date(vault.createdAt).getTime())) * 100)) : null
  return <button className="vault-card" onClick={() => onOpen(vault.id)}><div className="vault-card-top"><div className={`vault-symbol ${vault.kind}`}>{vault.kind === 'shared' ? <Users /> : <LockKeyhole />}</div><span className={`status ${copy.className}`}><span />{copy.label}</span></div><div className="vault-card-title"><strong>{vault.name}</strong><ChevronRight /></div><div className="vault-amount"><span>Saldo actual</span><b>{formatEth(amount)}</b></div>{progress !== null ? <div className="progress-track"><div suppressHydrationWarning style={{ width: `${progress}%` }} /></div> : <div className="progress-spacer" />}<div className="vault-card-meta"><span><Clock3 /> Desbloqueo</span><b>{dateLabel(vault.unlockAt)}</b></div>{vault.kind === 'shared' && <div className="participants"><Users /> {vault.contributions.length} participantes <span>{vault.accepted === false ? 'Sin aceptar' : `${vault.approvals.length}/2 aprobaciones`}</span></div>}</button>
}
function Step({ icon, number, title, text }: { icon: React.ReactNode; number: string; title: string; text: string }) { return <div className="step"><div className="step-icon">{icon}</div><span>{number}</span><h3>{title}</h3><p>{text}</p></div> }

function CreateModal({ kind, setKind, form, setForm, live, busy, onClose, onSubmit }: { kind: VaultKind; setKind: (kind: VaultKind) => void; form: FormState; setForm: (form: FormState) => void; live: boolean; busy: boolean; onClose: () => void; onSubmit: (event: React.FormEvent) => void }) {
  const sharedLive = live && kind === 'shared'
  return <div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button className="modal-close" onClick={onClose} aria-label="Cerrar"><X /></button><div className="modal-kicker">NUEVA BÓVEDA · {live ? 'SEPOLIA' : 'MODO DEMO'}</div><h2 id="modal-title">¿Qué querés ahorrar?</h2><p className="modal-intro">Elegí el tipo de bóveda que mejor se adapta a tu objetivo.</p><div className="type-picker"><button type="button" className={kind === 'individual' ? 'selected' : ''} onClick={() => setKind('individual')}><div className="type-icon gold"><LockKeyhole /></div><strong>Individual</strong><span>Ahorrá por tu cuenta.</span></button><button type="button" className={kind === 'shared' ? 'selected shared-selected' : ''} onClick={() => setKind('shared')}><div className="type-icon purple"><Users /></div><strong>Compartida 2 de 2</strong><span>Con consentimiento mutuo.</span></button></div>
    <form onSubmit={onSubmit} className="vault-form">
      <label>Nombre de la bóveda<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ej. Fondo de emergencia" /><small>Hasta 64 bytes: las tildes y los emojis ocupan más de uno.</small></label>
      <div className="form-row">{!sharedLive && <label>Importe inicial<input required inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" /><small>ETH · máximo 18 decimales</small></label>}<label>Fecha de desbloqueo<input required type="datetime-local" value={form.unlock} onChange={(e) => setForm({ ...form, unlock: e.target.value })} /><small>{kind === 'shared' ? 'Es fija: después no se puede cambiar.' : 'Después solo se puede postergar, nunca adelantar.'}</small></label></div>
      {kind === 'shared' && <label>Wallet del segundo participante<input required value={form.partner} onChange={(e) => setForm({ ...form, partner: e.target.value })} placeholder="0x..." /><small>{live ? 'Recibe una invitación y tiene que aceptarla desde su wallet.' : 'En demo podés usar cualquier dirección hexadecimal.'}</small></label>}
      <div className="form-note"><Info /> {live
        ? (sharedLive
          ? 'Se crea una invitación sin fondos. Cuando la otra persona la acepte, cada uno aporta lo suyo y al vencer, con las dos aprobaciones, cada uno retira exactamente lo que aportó.'
          : 'Vas a firmar una transacción en Sepolia con MetaMask. Los fondos quedan bloqueados en el contrato hasta la fecha elegida. Revisá bien la fecha: no hay forma de adelantarla.')
        : 'Las operaciones on-chain pueden requerir gas. En este modo los datos se guardan solo en tu navegador y no se mueven ETH reales.'}</div>
      <button className="primary-button full" type="submit" disabled={busy}>{busy ? 'Esperando confirmación…' : sharedLive ? 'Enviar invitación' : 'Crear bóveda'} <ArrowUpRight /></button>
    </form></div></div>
}

function DetailModal({ vault, identity, setIdentity, onClose, onApprove, onWithdraw }: { vault: Vault; identity: string; setIdentity: (value: string) => void; onClose: () => void; onApprove: () => void; onWithdraw: () => void }) {
  const unlocked = new Date(vault.unlockAt).getTime() <= Date.now()
  const approved = vault.approvals.includes(identity)
  const status = statusCopy(vault)
  const total = vault.contributions.reduce((sum, c) => sum + c.amount, 0)
  return <div className="modal-backdrop"><div className="modal detail-modal" role="dialog" aria-modal="true" aria-labelledby="detail-title">
    <button className="modal-close" onClick={onClose} aria-label="Cerrar"><X /></button>
    <div className="detail-header"><div className={`vault-symbol ${vault.kind}`}>{vault.kind === 'shared' ? <Users /> : <LockKeyhole />}</div><div><div className="modal-kicker">DETALLE DE BÓVEDA</div><h2 id="detail-title">{vault.name}</h2><span className={`status ${status.className}`}><span />{status.label}</span></div></div>
    <div className="detail-balance"><span>Total aportado</span><strong>{formatEth(total)}</strong><small>Desbloqueo: {dateLabel(vault.unlockAt)} · {unlocked ? 'fecha cumplida' : relativeTime(vault.unlockAt)}</small></div>
    {vault.kind === 'shared' && <div className="consensus-box"><div className="consensus-title"><ShieldCheck /> CONSENSO 2 DE 2 <span>{vault.approvals.length}/2</span></div><p>Ambos participantes deben aprobar después del vencimiento.</p><div className="approval-list">{vault.contributions.map((entry, index) => <div key={entry.address}><span className={vault.approvals.includes(entry.address) ? 'approval-avatar done' : 'approval-avatar'}>{vault.approvals.includes(entry.address) ? <Check /> : index === 0 ? 'A' : 'B'}</span><span>Participante {index === 0 ? 'A' : 'B'}<small>{shortAddress(entry.address)}</small></span><b className={vault.approvals.includes(entry.address) ? 'approved' : ''}>{vault.approvals.includes(entry.address) ? 'Aprobado' : 'Pendiente'}</b></div>)}</div><div className="identity-switch"><span>Identidad de demo</span><select value={identity} onChange={(e) => setIdentity(e.target.value)}><option value={DEMO_WALLET}>Participante A</option><option value={DEMO_PARTNER}>Participante B</option></select></div></div>}
    <div className="detail-actions">{vault.kind === 'shared' && <button className="outline-button" onClick={onApprove} disabled={!unlocked || approved || vault.approvals.length >= 2}>{approved ? 'Ya aprobaste' : 'Aprobar retiro'}</button>}<button className="primary-button" onClick={onWithdraw} disabled={!unlocked || (vault.kind === 'shared' && vault.approvals.length < 2)}>Retirar fondos <ArrowUpRight /></button></div>
  </div></div>
}

/** Detalle de una bóveda leída del contrato, con las acciones reales según quién mira y en qué estado está. */
function ChainDetailModal({ vault, account, busy, actions, onClose }: { vault: Vault; account: string; busy: string | null; actions: ChainActions; onClose: () => void }) {
  const [amount, setAmount] = useState('')
  const [newDate, setNewDate] = useState('')
  const unlocked = new Date(vault.unlockAt).getTime() <= Date.now()
  const status = statusCopy(vault)
  const total = vault.contributions.reduce((sum, c) => sum + (c.withdrawn ? 0 : c.amount), 0)
  const myIndex = vault.contributions.findIndex((c) => sameAddress(c.address, account))
  const mine = myIndex >= 0 ? vault.contributions[myIndex] : undefined
  const approvedByMe = vault.approvals.some((a) => sameAddress(a, account))
  const disabled = busy !== null
  const explorer = `${ETHERSCAN_URL}/address/${CONTRACT_ADDRESS}`

  const depositForm = (label: string) => <form className="inline-form" onSubmit={async (e) => { e.preventDefault(); if (await actions.deposit(vault, amount)) setAmount('') }}><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Monto en ETH" aria-label="Monto en ETH" /><button className="outline-button" type="submit" disabled={disabled || !amount}>{label}</button></form>

  return <div className="modal-backdrop"><div className="modal detail-modal" role="dialog" aria-modal="true" aria-labelledby="detail-title">
    <button className="modal-close" onClick={onClose} aria-label="Cerrar"><X /></button>
    <div className="detail-header"><div className={`vault-symbol ${vault.kind}`}>{vault.kind === 'shared' ? <Users /> : <LockKeyhole />}</div><div><div className="modal-kicker">DETALLE DE BÓVEDA · #{String(vault.onchainId)} {vault.kind === 'shared' ? 'COMPARTIDA' : 'INDIVIDUAL'}</div><h2 id="detail-title">{vault.name}</h2><span className={`status ${status.className}`}><span />{status.label}</span></div></div>
    <div className="detail-balance"><span>{vault.kind === 'shared' ? 'Total en la bóveda' : 'Saldo'}</span><strong>{formatEth(total)}</strong><small>Desbloqueo: {dateLabel(vault.unlockAt)} · {unlocked ? 'fecha cumplida' : relativeTime(vault.unlockAt)}</small></div>

    {vault.kind === 'individual' && !mine?.withdrawn && <div className="action-panel">
      <span className="action-title">Sumar fondos</span>
      {depositForm('Depositar')}
      <span className="action-title">Postergar la fecha</span>
      <form className="inline-form" onSubmit={async (e) => { e.preventDefault(); if (await actions.extend(vault, newDate)) setNewDate('') }}><input type="datetime-local" value={newDate} onChange={(e) => setNewDate(e.target.value)} aria-label="Nueva fecha de desbloqueo" /><button className="outline-button" type="submit" disabled={disabled || !newDate}>Postergar</button></form>
      <small>La fecha solo se puede mover hacia adelante.</small>
    </div>}

    {vault.kind === 'shared' && <div className="consensus-box"><div className="consensus-title"><ShieldCheck /> CONSENSO 2 DE 2 <span>{vault.accepted ? `${vault.approvals.length}/2` : 'SIN ACEPTAR'}</span></div>
      <p>{vault.accepted
        ? 'Cada titular aprueba una vez, antes o después de la fecha. El retiro exige la fecha cumplida y las dos aprobaciones, y cada uno retira exactamente lo que aportó.'
        : myIndex === 1
          ? 'Te invitaron a esta bóveda compartida. Hasta que aceptes, nadie puede aportar ni aprobar. La fecha de desbloqueo es fija.'
          : 'Esperando que la otra persona acepte la invitación. Hasta entonces nadie puede aportar ni aprobar.'}</p>
      <div className="approval-list">{vault.contributions.map((entry, index) => { const ok = vault.approvals.some((a) => sameAddress(a, entry.address)); return <div key={entry.address}><span className={ok ? 'approval-avatar done' : 'approval-avatar'}>{ok ? <Check /> : index === 0 ? 'A' : 'B'}</span><span>{index === myIndex ? 'Vos' : index === 0 ? 'Creador/a' : 'Invitado/a'} · {formatEth(entry.amount)}{entry.withdrawn ? ' (retirado)' : ''}<small>{shortAddress(entry.address)}</small></span><b className={ok ? 'approved' : ''}>{!vault.accepted && index === 1 ? 'Sin aceptar' : ok ? 'Aprobado' : 'Pendiente'}</b></div> })}</div>
      {vault.accepted && mine && !mine.withdrawn && <div className="action-panel compact"><span className="action-title">Sumar a tu aporte</span>{depositForm('Aportar')}</div>}
    </div>}

    {busy && <p className="tx-status" role="status">{busy}</p>}
    <div className="detail-actions">
      {vault.kind === 'shared' && !vault.accepted && myIndex === 1 && <button className="primary-button" onClick={() => actions.accept(vault)} disabled={disabled}>Aceptar invitación <Check /></button>}
      {vault.kind === 'shared' && vault.accepted && <button className="outline-button" onClick={() => actions.approve(vault)} disabled={disabled || approvedByMe || !mine || mine.withdrawn}>{approvedByMe ? 'Ya aprobaste' : 'Aprobar retiro'}</button>}
      {(vault.kind === 'individual' || vault.accepted) && <button className="primary-button" onClick={() => actions.withdraw(vault)} disabled={disabled || !unlocked || !mine || mine.withdrawn || mine.amount === 0 || (vault.kind === 'shared' && vault.approvals.length < 2)}>{mine?.withdrawn ? 'Ya retiraste' : vault.kind === 'shared' ? 'Retirar mi aporte' : 'Retirar fondos'} <ArrowUpRight /></button>}
    </div>
    <p className="detail-footnote">Contrato verificado: <a href={explorer} target="_blank" rel="noopener noreferrer">{shortAddress(CONTRACT_ADDRESS)} en Etherscan</a></p>
  </div></div>
}

function ContentSection({ activeNav, vaults, live, onOpen, onCreate }: { activeNav: string; vaults: Vault[]; live: boolean; onOpen: (id: string) => void; onCreate: () => void }) {
  if (activeNav === 'Mis bóvedas' || activeNav === 'Compartidas') {
    const list = activeNav === 'Compartidas' ? vaults.filter((v) => v.kind === 'shared') : vaults.filter((v) => !v.invitation)
    const invitations = list.filter((v) => v.invitation)
    const rest = list.filter((v) => !v.invitation)
    return <><div className="page-heading"><div className="eyebrow"><span className="eyebrow-line" /> PANEL DE CONTROL</div><h1>{activeNav}</h1><p>Administrá tus objetivos con reglas claras y verificables.</p></div>
      {invitations.length > 0 && <><h2 className="list-subtitle">Invitaciones pendientes</h2><p className="list-note">Solo aparecen acá: cualquiera puede invitarte, así que aceptá únicamente las que reconozcas.</p><div className="vault-list-page">{invitations.map((vault) => <VaultCard key={vault.id} vault={vault} onOpen={onOpen} />)}</div><h2 className="list-subtitle">Tus bóvedas</h2></>}
      <div className="vault-list-page">{rest.map((vault) => <VaultCard key={vault.id} vault={vault} onOpen={onOpen} />)}<button className="add-card" onClick={onCreate}><Plus /><strong>Crear nueva bóveda</strong><span>Empezá un objetivo de ahorro</span></button></div></>
  }
  return <div className="page-heading"><div className="eyebrow"><span className="eyebrow-line" /> TIMELOCK VAULT</div><h1>{activeNav}</h1><p>{activeNav === 'Actividad' ? (live ? 'Próximamente: el historial de cada bóveda, armado con los eventos del contrato.' : 'Cada evento de demo se identifica claramente y no representa una transacción real.') : activeNav === 'Seguridad' ? 'Tus reglas, tus claves y tus decisiones siempre están en el centro.' : 'Un modelo de ahorro temporal simple, transparente y fácil de entender.'}</p><div className="info-panels"><div><ShieldCheck /><h3>Reglas verificables</h3><p>La propiedad, la fecha de desbloqueo y el consenso se comprueban antes de cada retiro.</p></div><div><LockKeyhole /><h3>Sin rendimientos</h3><p>Timelock Vault no es una inversión. Solo ayuda a guardar fondos bajo reglas definidas.</p></div><div><Users /><h3>Consentimiento mutuo</h3><p>En bóvedas compartidas, una dirección no puede aprobar en nombre de la otra.</p></div></div></div>
}
