'use client'

// Conexión con MetaMask (o cualquier wallet compatible con EIP-1193) y control de red.
import { useCallback, useEffect, useState } from 'react'
import { BrowserProvider, type JsonRpcSigner } from 'ethers'
import { SEPOLIA_CHAIN_ID, SEPOLIA_CHAIN_ID_HEX } from './contract'

type Eip1193 = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
  on?: (event: string, handler: (...args: unknown[]) => void) => void
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void
}

declare global {
  interface Window {
    ethereum?: Eip1193
  }
}

export type WalletState = {
  available: boolean
  account: string | null
  chainId: bigint | null
  onSepolia: boolean
  signer: JsonRpcSigner | null
  connecting: boolean
}

export function useWallet() {
  const [state, setState] = useState<WalletState>({ available: false, account: null, chainId: null, onSepolia: false, signer: null, connecting: false })

  const refresh = useCallback(async () => {
    const ethereum = window.ethereum
    if (!ethereum) return setState((s) => ({ ...s, available: false }))
    const provider = new BrowserProvider(ethereum)
    const accounts = (await ethereum.request({ method: 'eth_accounts' })) as string[]
    const { chainId } = await provider.getNetwork()
    const account = accounts[0] ?? null
    const signer = account ? await provider.getSigner(account) : null
    setState({ available: true, account, chainId, onSepolia: chainId === SEPOLIA_CHAIN_ID, signer, connecting: false })
  }, [])

  useEffect(() => {
    refresh().catch(() => undefined)
    const ethereum = window.ethereum
    if (!ethereum?.on) return
    const handler = () => { refresh().catch(() => undefined) }
    ethereum.on('accountsChanged', handler)
    ethereum.on('chainChanged', handler)
    return () => {
      ethereum.removeListener?.('accountsChanged', handler)
      ethereum.removeListener?.('chainChanged', handler)
    }
  }, [refresh])

  const connect = useCallback(async () => {
    const ethereum = window.ethereum
    if (!ethereum) throw new Error('No se encontró MetaMask en este navegador.')
    setState((s) => ({ ...s, connecting: true }))
    try {
      await ethereum.request({ method: 'eth_requestAccounts' })
      await refresh()
    } finally {
      setState((s) => ({ ...s, connecting: false }))
    }
  }, [refresh])

  const switchToSepolia = useCallback(async () => {
    await window.ethereum?.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: SEPOLIA_CHAIN_ID_HEX }] })
    await refresh()
  }, [refresh])

  return { ...state, connect, switchToSepolia, refresh }
}
