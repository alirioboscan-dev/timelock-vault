'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Copy,
  FileClock,
  Gauge,
  History,
  Info,
  Landmark,
  LockKeyhole,
  Menu,
  Plus,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Users,
  WalletCards,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createInitialVaults, DEMO_PARTNER, DEMO_WALLET, formatEth, getVaultStatus, shortAddress, totalVaultAmount, type Vault, type VaultKind } from '@/lib/vaults'

const navItems = [
  { label: 'Resumen', icon: Gauge },
  { label: 'Mis bóvedas', icon: LockKeyhole },
  { label: 'Compartidas', icon: Users },
  { label: 'Actividad', icon: History },
  { label: 'Seguridad', icon: ShieldCheck },
  { label: 'Cómo funciona', icon: CircleHelp },
]

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
  if (status === 'released') return { label: 'Retirada', className: 'status-muted' }
  if (status === 'available') return { label: vault.kind === 'shared' ? 'Liberación autorizada' : 'Disponible para retirar', className: 'status-green' }
  return { label: 'Bloqueada', className: 'status-gold' }
}

export default function TimelockVault() {
  const [vaults, setVaults] = useState<Vault[]>(createInitialVaults)
  const [activeNav, setActiveNav] = useState('Resumen')
  const [showCreate, setShowCreate] = useState(false)
  const [kind, setKind] = useState<VaultKind>('individual')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [demoIdentity, setDemoIdentity] = useState(DEMO_WALLET)
  const [toast, setToast] = useState('')
  const [form, setForm] = useState({ name: '', amount: '', partner: DEMO_PARTNER, unlock: '' })

  useEffect(() => {
    const stored = window.localStorage.getItem('timelock-vault-demo')
    if (stored) setVaults(JSON.parse(stored))
  }, [])
  useEffect(() => { window.localStorage.setItem('timelock-vault-demo', JSON.stringify(vaults)) }, [vaults])
  useEffect(() => { if (toast) { const timer = window.setTimeout(() => setToast(''), 2800); return () => window.clearTimeout(timer) } }, [toast])

  const individual = vaults.filter((vault) => vault.kind === 'individual')
  const shared = vaults.filter((vault) => vault.kind === 'shared')
  const total = totalVaultAmount(vaults)
  const nextUnlock = [...vaults].filter((vault) => getVaultStatus(vault) === 'locked').sort((a, b) => +new Date(a.unlockAt) - +new Date(b.unlockAt))[0]
  const detail = detailId ? vaults.find((vault) => vault.id === detailId) : null

  function openCreate(selected: VaultKind = 'individual') { setKind(selected); setShowCreate(true) }
  function createVault(event: React.FormEvent) {
    event.preventDefault()
    const amount = Number(form.amount)
    const validName = form.name.trim().length >= 3 && form.name.trim().length <= 42
    const unlock = new Date(form.unlock).getTime()
    if (!validName || !amount || amount <= 0 || !Number.isFinite(amount) || amount.toString().split('.')[1]?.length > 18 || !unlock || unlock <= Date.now() || (kind === 'shared' && (!/^0x[a-fA-F0-9]{8,40}$/.test(form.partner) || form.partner === DEMO_WALLET))) {
      setToast('Revisá los datos del formulario antes de continuar.')
      return
    }
    const newVault: Vault = { id: crypto.randomUUID(), kind, name: form.name.trim(), createdAt: new Date().toISOString(), unlockAt: new Date(unlock).toISOString(), contributions: kind === 'shared' ? [{ address: DEMO_WALLET, amount, withdrawn: false }, { address: form.partner, amount: 0, withdrawn: false }] : [{ address: DEMO_WALLET, amount, withdrawn: false }], approvals: [] }
    setVaults((current) => [newVault, ...current]); setShowCreate(false); setForm({ name: '', amount: '', partner: DEMO_PARTNER, unlock: '' }); setToast('Bóveda creada en modo demo.')
  }
  function approve() {
    if (!detail || getVaultStatus(detail) !== 'locked' || new Date(detail.unlockAt).getTime() > Date.now()) { setToast('La aprobación estará disponible cuando llegue la fecha.'); return }
    setVaults((current) => current.map((vault) => vault.id === detail.id && !vault.approvals.includes(demoIdentity) ? { ...vault, approvals: [...vault.approvals, demoIdentity] } : vault)); setToast('Aprobación registrada localmente.')
  }
  function withdraw() {
    if (!detail || getVaultStatus(detail) !== 'available') { setToast('Los fondos todavía no están disponibles para retirar.'); return }
    setVaults((current) => current.map((vault) => vault.id === detail.id ? { ...vault, contributions: vault.contributions.map((entry) => entry.address === demoIdentity ? { ...entry, withdrawn: true } : entry) } : vault)); setToast('Retiro simulado. No se movieron fondos reales.')
  }
  function resetDemo() { setVaults(createInitialVaults()); setToast('Datos de demostración restablecidos.') }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><LockKeyhole /></div><span>Timelock <b>Vault</b></span></div>
        <div className="demo-pill"><span className="pulse-dot" /> MODO DEMO <button onClick={resetDemo} aria-label="Restablecer datos"><RotateCcw /></button></div>
        <nav aria-label="Navegación principal" className="nav-list">
          {navItems.map(({ label, icon: Icon }) => <button key={label} className={`nav-item ${activeNav === label ? 'active' : ''}`} onClick={() => setActiveNav(label)}><Icon />{label}</button>)}
        </nav>
        <div className="sidebar-bottom"><div className="help-card"><Sparkles /><div><strong>Diseñado para ahorrar</strong><span>Reglas claras, control total.</span></div></div><div className="wallet-mini"><div className="wallet-avatar"><WalletCards /></div><div><strong>{shortAddress(DEMO_WALLET)}</strong><span>Wallet de demo</span></div><ChevronRight /></div></div>
      </aside>
      <main className="main-content">
        <header className="topbar"><button className="mobile-menu" aria-label="Abrir menú"><Menu /></button><div className="breadcrumb">Timelock Vault <ChevronRight /> <span>{activeNav}</span></div><div className="top-actions"><div className="network"><span className="network-dot" /> Red no conectada</div><button className="connect-button" onClick={() => setToast('Conectá MetaMask cuando el contrato esté configurado.') }><WalletCards /> Conectar wallet</button></div></header>
        {activeNav === 'Resumen' ? <>
          <section className="hero"><div><div className="eyebrow"><span className="eyebrow-line" /> AHORRO PROGRAMADO EN ETH</div><h1>Ahorrá hoy.<br /><em>Desbloqueá</em> cuando llegue tu fecha.</h1><p>Creá una bóveda individual o ahorrá con otra persona. Reglas verificables para que retires solo cuando corresponde.</p><button className="primary-button" onClick={() => openCreate()}><Plus /> Crear bóveda <span className="button-arrow"><ArrowUpRight /></span></button></div><div className="hero-lock"><div className="orbital orbital-one" /><div className="orbital orbital-two" /><div className="lock-illustration"><LockKeyhole /></div><span className="orbit-label label-top">FECHA FIJA</span><span className="orbit-label label-bottom">CONTROL TOTAL</span></div></section>
          <section className="stats-grid"><div className="stat-card"><div className="stat-icon gold"><Landmark /></div><span>Total bloqueado</span><strong>{formatEth(total)}</strong><small><span className="positive">●</span> En tus bóvedas activas</small></div><div className="stat-card"><div className="stat-icon purple"><Clock3 /></div><span>Próximo desbloqueo</span><strong>{nextUnlock ? relativeTime(nextUnlock.unlockAt) : '—'}</strong><small>{nextUnlock ? nextUnlock.name : 'Sin bóvedas pendientes'}</small></div><div className="stat-card"><div className="stat-icon blue"><LockKeyhole /></div><span>Bóvedas activas</span><strong>{vaults.filter((v) => getVaultStatus(v) !== 'released').length}</strong><small>Individuales y compartidas</small></div></section>
          <section className="section-heading"><div><h2>Tus bóvedas</h2><p>Seguimiento de tus objetivos de ahorro.</p></div><button className="text-button" onClick={() => setActiveNav('Mis bóvedas')}>Ver todas <ArrowUpRight /></button></section>
          <div className="vault-columns"><VaultColumn title="Mis bóvedas individuales" icon={<LockKeyhole />} vaults={individual} onOpen={setDetailId} /><VaultColumn title="Mis bóvedas compartidas" icon={<Users />} vaults={shared} onOpen={setDetailId} /></div>
          <section className="how-section"><div className="section-heading"><div><h2>Cómo funciona</h2><p>Simple por diseño. Seguro por reglas.</p></div><button className="text-button" onClick={() => setActiveNav('Cómo funciona')}>Conocé más <ArrowUpRight /></button></div><div className="steps"><Step icon={<ArrowDownToLine />} number="01" title="Depositá" text="Elegí cuánto querés guardar en tu bóveda." /><Step icon={<LockKeyhole />} number="02" title="Bloqueá" text="Definí una fecha y dejá que el tiempo haga su parte." /><Step icon={<Check />} number="03" title="Liberá" text="Retirá cuando se cumpla la fecha y las reglas." /></div></section>
        </> : <ContentSection activeNav={activeNav} vaults={vaults} onOpen={setDetailId} onCreate={() => openCreate()} />}
      </main>
      {showCreate && <CreateModal kind={kind} setKind={setKind} form={form} setForm={setForm} onClose={() => setShowCreate(false)} onSubmit={createVault} />}
      {detail && <DetailModal vault={detail} identity={demoIdentity} setIdentity={setDemoIdentity} onClose={() => setDetailId(null)} onApprove={approve} onWithdraw={withdraw} />}
      {toast && <div className="toast"><Info /> {toast}</div>}
    </div>
  )
}

function VaultColumn({ title, icon, vaults, onOpen }: { title: string; icon: React.ReactNode; vaults: Vault[]; onOpen: (id: string) => void }) { return <div className="vault-group"><div className="group-title"><span>{icon}</span><h3>{title}</h3><b>{vaults.length}</b></div>{vaults.map((vault) => <VaultCard key={vault.id} vault={vault} onOpen={onOpen} />)}</div> }
function VaultCard({ vault, onOpen }: { vault: Vault; onOpen: (id: string) => void }) { const copy = statusCopy(vault); const amount = vault.contributions.reduce((sum, c) => sum + (c.withdrawn ? 0 : c.amount), 0); const progress = Math.max(4, Math.min(100, ((Date.now() - new Date(vault.createdAt).getTime()) / (new Date(vault.unlockAt).getTime() - new Date(vault.createdAt).getTime())) * 100)); return <button className="vault-card" onClick={() => onOpen(vault.id)}><div className="vault-card-top"><div className={`vault-symbol ${vault.kind}`}><>{vault.kind === 'shared' ? <Users /> : <LockKeyhole />}</></div><span className={`status ${copy.className}`}><span />{copy.label}</span></div><div className="vault-card-title"><strong>{vault.name}</strong><ChevronRight /></div><div className="vault-amount"><span>Saldo actual</span><b>{formatEth(amount)}</b></div><div className="progress-track"><div style={{ width: `${progress}%` }} /></div><div className="vault-card-meta"><span><Clock3 /> Desbloqueo</span><b>{dateLabel(vault.unlockAt)}</b></div>{vault.kind === 'shared' && <div className="participants"><Users /> {vault.contributions.length} participantes <span>{vault.approvals.length}/2 aprobaciones</span></div>}</button> }
function Step({ icon, number, title, text }: { icon: React.ReactNode; number: string; title: string; text: string }) { return <div className="step"><div className="step-icon">{icon}</div><span>{number}</span><h3>{title}</h3><p>{text}</p></div> }

function CreateModal({ kind, setKind, form, setForm, onClose, onSubmit }: { kind: VaultKind; setKind: (kind: VaultKind) => void; form: { name: string; amount: string; partner: string; unlock: string }; setForm: (form: { name: string; amount: string; partner: string; unlock: string }) => void; onClose: () => void; onSubmit: (event: React.FormEvent) => void }) { return <div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button className="modal-close" onClick={onClose} aria-label="Cerrar"><X /></button><div className="modal-kicker">NUEVA BÓVEDA · MODO DEMO</div><h2 id="modal-title">¿Qué querés ahorrar?</h2><p className="modal-intro">Elegí el tipo de bóveda que mejor se adapta a tu objetivo.</p><div className="type-picker"><button className={kind === 'individual' ? 'selected' : ''} onClick={() => setKind('individual')}><div className="type-icon gold"><LockKeyhole /></div><strong>Individual</strong><span>Ahorrá por tu cuenta.</span></button><button className={kind === 'shared' ? 'selected shared-selected' : ''} onClick={() => setKind('shared')}><div className="type-icon purple"><Users /></div><strong>Compartida 2 de 2</strong><span>Con consentimiento mutuo.</span></button></div><form onSubmit={onSubmit} className="vault-form"><label>Nombre de la bóveda<input required maxLength={42} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ej. Fondo de emergencia" /></label><div className="form-row"><label>Importe inicial<input required inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" /><small>ETH · máximo 18 decimales</small></label><label>Fecha de desbloqueo<input required type="datetime-local" value={form.unlock} onChange={(e) => setForm({ ...form, unlock: e.target.value })} /></label></div>{kind === 'shared' && <label>Wallet del segundo participante<input required value={form.partner} onChange={(e) => setForm({ ...form, partner: e.target.value })} placeholder="0x..." /><small>En demo podés usar cualquier dirección hexadecimal.</small></label>}<div className="form-note"><Info /> Las operaciones on-chain pueden requerir gas. En este modo los datos se guardan solo en tu navegador y no se mueven ETH reales.</div><button className="primary-button full" type="submit">Crear bóveda <ArrowUpRight /></button></form></div></div> }

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

function ContentSection({ activeNav, vaults, onOpen, onCreate }: { activeNav: string; vaults: Vault[]; onOpen: (id: string) => void; onCreate: () => void }) { if (activeNav === 'Mis bóvedas' || activeNav === 'Compartidas') { const list = activeNav === 'Compartidas' ? vaults.filter((v) => v.kind === 'shared') : vaults; return <><div className="page-heading"><div className="eyebrow"><span className="eyebrow-line" /> PANEL DE CONTROL</div><h1>{activeNav}</h1><p>Administrá tus objetivos con reglas claras y verificables.</p></div><div className="vault-list-page">{list.map((vault) => <VaultCard key={vault.id} vault={vault} onOpen={onOpen} />)}<button className="add-card" onClick={onCreate}><Plus /><strong>Crear nueva bóveda</strong><span>Empezá un objetivo de ahorro</span></button></div></> } return <div className="page-heading"><div className="eyebrow"><span className="eyebrow-line" /> TIMЕLOCK VAULT</div><h1>{activeNav}</h1><p>{activeNav === 'Actividad' ? 'Cada evento de demo se identifica claramente y no representa una transacción real.' : activeNav === 'Seguridad' ? 'Tus reglas, tus claves y tus decisiones siempre están en el centro.' : 'Un modelo de ahorro temporal simple, transparente y fácil de entender.'}</p><div className="info-panels"><div><ShieldCheck /><h3>Reglas verificables</h3><p>La propiedad, la fecha de desbloqueo y el consenso se comprueban antes de cada retiro.</p></div><div><LockKeyhole /><h3>Sin rendimientos</h3><p>Timelock Vault no es una inversión. Solo ayuda a guardar fondos bajo reglas definidas.</p></div><div><Users /><h3>Consentimiento mutuo</h3><p>En bóvedas compartidas, una dirección no puede aprobar en nombre de la otra.</p></div></div></div> }
