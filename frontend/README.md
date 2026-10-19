# Timelock Vault: frontend

Aplicación web (Next.js 16 + React 19) para crear y administrar bóvedas de ahorro en ETH sobre el contrato `TimelockVault` desplegado en Sepolia.

El diseño y el modo demo son el prototipo original de Nico ([devnicogonzalez/timelock](https://github.com/devnicogonzalez/timelock), commit `962d3ec`, hecho con v0). La conexión con el contrato se agregó encima, sin cambiar el diseño.

## Dos modos

| Modo | Cómo se activa | Datos |
|---|---|---|
| **Demo** | Por defecto, sin wallet | Bóvedas de ejemplo guardadas en el navegador. No se mueven ETH reales. |
| **Sepolia · en vivo** | Botón **Conectar wallet** (MetaMask en Sepolia) | Se leen y se escriben en el contrato v2 [`0xF5bbf82c0c79a052b3Fc0B5c79387d3DfeAd4b5F`](https://sepolia.etherscan.io/address/0xF5bbf82c0c79a052b3Fc0B5c79387d3DfeAd4b5F#code). |

El botón con la flecha circular de la barra lateral vuelve al modo demo.

## Qué se puede hacer en modo en vivo

- **Bóveda individual:** crearla con un depósito inicial, sumar fondos, postergar la fecha (nunca adelantarla) y retirar todo al llegar la fecha.
- **Bóveda compartida 2/2:** crearla como invitación (sin fondos), que la otra persona la acepte, aportar cada uno por separado, aprobar el retiro y retirar cada uno lo que aportó, con la fecha cumplida y las dos aprobaciones.
- **Invitaciones pendientes:** se leen de los eventos `SharedVaultCreated` del contrato. Aparecen en **Compartidas** con un aviso, y una invitación con nombre inválido no rompe la lista.
- **Errores:** cada error del contrato se muestra con un mensaje claro en español (`lib/contract.ts`). Cada transacción muestra el link a Etherscan.

## Cómo correrla

Necesita Node.js 20 o posterior. El proyecto usa pnpm:

```bash
cd frontend
npx pnpm install
npx pnpm dev
```

Y abrir http://localhost:3000.

## Variables de entorno (opcionales)

Por defecto apunta al contrato v2 en Sepolia. Para otra red o contrato, crear `frontend/.env.local`:

```
NEXT_PUBLIC_TIMELOCK_ADDRESS=0x...
NEXT_PUBLIC_TIMELOCK_DEPLOY_BLOCK=0
```

Son datos públicos: **nunca** poner claves privadas en variables `NEXT_PUBLIC_*`, porque terminan en el navegador.

## Estructura

| Archivo | Qué hace |
|---|---|
| `components/timelock-vault.tsx` | Toda la interfaz: modo demo y modo en vivo |
| `lib/contract.ts` | Dirección, bloque de despliegue, ABI y mensajes de error del contrato |
| `lib/chain.ts` | Lecturas, invitaciones, validaciones y traducción de errores (sin React; se puede probar aparte) |
| `lib/use-wallet.ts` | Conexión con MetaMask y cambio a Sepolia |
| `lib/vaults.ts` | Tipos, datos de demo y estado de cada bóveda |

## Pendiente

- Pantalla **Actividad** con el historial armado desde los eventos del contrato.
- Paginar las invitaciones si una cuenta recibe muchas.
